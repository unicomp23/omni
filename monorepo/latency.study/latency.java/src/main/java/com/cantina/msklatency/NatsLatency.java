package com.cantina.msklatency;

import io.nats.client.*;
import io.nats.client.api.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;

import java.util.concurrent.CompletableFuture;

public class NatsLatency {
    private static final Logger log = LoggerFactory.getLogger(NatsLatency.class);
    private static final int NUM_MESSAGES = 1000000;
    private static final String SUBJECT_PREFIX = "latency-test-";
    private static final String NATS_URL = System.getenv("NATS_URL") != null ? 
                                           System.getenv("NATS_URL") : 
                                           "nats://shasta-nats-1:4222";
    private static final int BUFFER_SIZE = 10000;
    private static final AtomicBoolean shutdownSignal = new AtomicBoolean(false);
    private static final long TIMEOUT_MICROS = TimeUnit.MINUTES.toMicros(5); // 5 minutes in microseconds
    private static final int WARM_UP_MESSAGES = 10000;
    private static final long[] latencies = new long[NUM_MESSAGES - WARM_UP_MESSAGES];

    private static final int MESSAGE_SIZE = Long.BYTES * 2; // timestamp + seqNo
    private static final LatencyMessage[] preAllocatedMessages = new LatencyMessage[NUM_MESSAGES];
    private static final ByteBuffer[] preAllocatedBuffers = new ByteBuffer[NUM_MESSAGES];

    private static volatile boolean testCompleted = false;

    public static void run(String mode) throws IOException, InterruptedException {
        if (mode == null || (!mode.equalsIgnoreCase("js") && !mode.equalsIgnoreCase("core"))) {
            System.out.println("Usage: java NatsLatency <mode>");
            System.out.println("  mode: 'js' for JetStream or 'core' for NATS Core");
            return;
        }

        final boolean useJetStream = "js".equalsIgnoreCase(mode);
        String subject = SUBJECT_PREFIX + UUID.randomUUID().toString();
        String streamName = "latency-test-stream-" + UUID.randomUUID().toString();
        log.info("Using subject: {} and connecting to NATS at: {}", subject, NATS_URL);
        log.info("NATS mode: {}", useJetStream ? "JetStream" : "Core");

        // Pre-allocate messages and byte buffers
        for (int i = 0; i < NUM_MESSAGES; i++) {
            preAllocatedMessages[i] = new LatencyMessage();
            preAllocatedMessages[i].set(0, i);
            preAllocatedBuffers[i] = ByteBuffer.allocate(MESSAGE_SIZE);
        }

        Options options = new Options.Builder()
            .server(NATS_URL)
            .build();

        try (Connection nc = Nats.connect(options)) {
            log.info("Connected to NATS server. noTcpDelay is enabled by default.");

            final JetStream js;
            if (useJetStream) {
                // Check if JetStream is available and create a stream
                try {
                    JetStreamManagement jsm = nc.jetStreamManagement();
                    jsm.getStreamNames();
                    log.info("JetStream is available on NATS server: {}", NATS_URL);

                    StreamConfiguration streamConfig = StreamConfiguration.builder()
                        .name(streamName)
                        .subjects(subject)
                        .storageType(StorageType.Memory)
                        .replicas(1)
                        .build();

                    StreamInfo streamInfo = jsm.addStream(streamConfig);
                    log.info("Created JetStream and stream: {}", streamInfo);

                    js = nc.jetStream();
                } catch (JetStreamApiException e) {
                    log.error("JetStream is not available on NATS server: {}", NATS_URL, e);
                    return;
                }
            } else {
                js = null;
            }

            RingBuffer<LatencyMessage> producerBuffer = new RingBuffer<>(BUFFER_SIZE);
            RingBuffer<LatencyMessage> consumerBuffer = new RingBuffer<>(BUFFER_SIZE);

            CompletableFuture<Void> producerFuture = CompletableFuture.runAsync(() -> {
                try {
                    if (useJetStream) {
                        produceMessagesJS(js, producerBuffer, subject, streamName);
                    } else {
                        produceMessagesCore(nc, producerBuffer, subject);
                    }
                } catch (Exception e) {
                    log.error("Producer thread error", e);
                }
            });

            CompletableFuture<Void> consumerFuture = CompletableFuture.runAsync(() -> {
                try {
                    if (useJetStream) {
                        consumeMessagesJS(js, consumerBuffer, subject);
                    } else {
                        consumeMessagesCore(nc, consumerBuffer, subject);
                    }
                } catch (Exception e) {
                    log.error("Consumer thread error", e);
                }
            });

            long totalLatency = 0;
            int receivedMessages = 0;
            int warmUpMessages = 0;

            log.info("Starting producer and consumer threads");
            try {
                // Main processing loop
                for (int i = 0; i < NUM_MESSAGES && !shutdownSignal.get(); i++) {
                    long startTimeNano = System.nanoTime();
                    LatencyMessage message = preAllocatedMessages[i];
                    message.setTimestamp(startTimeNano);
                    while (!producerBuffer.write(message)) {
                        Thread.yield();
                        // Implement backpressure
                        if (consumerBuffer.size() > BUFFER_SIZE * 0.9) {
                            Thread.sleep(1);
                        }
                    }

                    LatencyMessage consumedMessage = consumerBuffer.read();
                    if (consumedMessage != null) {
                        long latency = System.nanoTime() - consumedMessage.getTimestamp();
                        if (warmUpMessages < WARM_UP_MESSAGES) {
                            warmUpMessages++;
                        } else {
                            latencies[receivedMessages] = latency;
                            totalLatency += latency;
                            receivedMessages++;
                        }
                    }

                    if (i % 10000 == 0) {
                        log.info("Processed {} messages", i);
                    }

                    if (TimeUnit.NANOSECONDS.toMicros(System.nanoTime() - startTimeNano) > TIMEOUT_MICROS) {
                        log.warn("Timeout reached after processing {} messages", i);
                        break;
                    }
                }
            } catch (Exception e) {
                log.error("Error in main processing loop", e);
            }

            // Consume any remaining messages
            while (receivedMessages < NUM_MESSAGES - WARM_UP_MESSAGES && !shutdownSignal.get()) {
                LatencyMessage message = consumerBuffer.read();
                if (message != null) {
                    long latency = System.nanoTime() - message.getTimestamp();
                    if (warmUpMessages < WARM_UP_MESSAGES) {
                        warmUpMessages++;
                    } else {
                        latencies[receivedMessages] = latency;
                        totalLatency += latency;
                        receivedMessages++;
                    }
                } else {
                    Thread.yield();
                }
            }

            // Wait for threads to finish
            shutdownSignal.set(true);
            try {
                CompletableFuture.allOf(producerFuture, consumerFuture)
                    .orTimeout(30, TimeUnit.SECONDS)
                    .whenComplete((result, exception) -> {
                        if (exception != null) {
                            log.warn("Timeout or error waiting for producer and consumer to finish", exception);
                        } else {
                            log.info("Producer and consumer threads finished successfully");
                        }
                    })
                    .join();
            } catch (Exception e) {
                log.warn("Error while waiting for producer and consumer to finish", e);
            }

            // Calculate and print latency statistics
            calculateAndPrintLatencyStats(totalLatency, receivedMessages);
            log.info("Latency test completed.");
            testCompleted = true;
        } catch (IOException e) {
            log.error("Error occurred: ", e);
        } finally {
            if (!testCompleted) {
                log.error("Test did not complete successfully.");
            }
            log.info("Exiting program.");
            System.exit(testCompleted ? 0 : 1);
        }
    }

    private static void calculateAndPrintLatencyStats(long totalLatency, int receivedMessages) {
        double avgLatency = totalLatency / (double) receivedMessages;
        System.out.printf("Average NATS latency: %.3f ms%n", avgLatency / 1_000_000.0);
        System.out.printf("Messages processed: %d (excluding %d warm-up messages)%n", receivedMessages, WARM_UP_MESSAGES);

        // Calculate and print percentiles
        Arrays.sort(latencies, 0, receivedMessages);
        System.out.println("Latency percentiles:");
        System.out.printf("50th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 50) / 1_000_000.0);
        System.out.printf("90th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 90) / 1_000_000.0);
        System.out.printf("95th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 95) / 1_000_000.0);
        System.out.printf("99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99) / 1_000_000.0);
        System.out.printf("99.9th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.9) / 1_000_000.0);
        System.out.printf("99.99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.99) / 1_000_000.0);
    }

    private static long calculatePercentile(long[] sortedLatencies, int size, double percentile) {
        int index = (int) Math.ceil(percentile / 100.0 * size) - 1;
        return sortedLatencies[Math.min(index, size - 1)];
    }

    private static void produceMessagesJS(JetStream js, RingBuffer<LatencyMessage> buffer, String subject, String streamName) {
        log.info("Starting producer thread");
        int i = 0;
        while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
            LatencyMessage message = buffer.read();
            if (message != null) {
                try {
                    ByteBuffer byteBuffer = preAllocatedBuffers[(int) message.getSeqNo()];
                    byteBuffer.clear();
                    message.writeTo(byteBuffer);
                    byteBuffer.flip();
                    byte[] data = new byte[byteBuffer.remaining()];
                    byteBuffer.get(data);
                    PublishOptions po = PublishOptions.builder().expectedStream(streamName).build();
                    js.publish(subject, data, po);
                    if (++i % 10000 == 0) {
                        log.debug("Producer published {} messages", i);
                    }
                } catch (JetStreamApiException | IOException e) {
                    log.error("Error publishing message", e);
                }
            } else {
                Thread.yield();
            }
        }
        log.info("Producer thread exiting. Published {} messages", i);
    }

    private static void consumeMessagesJS(JetStream js, RingBuffer<LatencyMessage> buffer, String subject) {
        log.info("Starting consumer thread");
        int i = 0;  // Move the declaration of i outside the try block
        try {
            PushSubscribeOptions pso = PushSubscribeOptions.builder().build();
            JetStreamSubscription sub = js.subscribe(subject, pso);
            
            LatencyMessage reuseMessage = new LatencyMessage();
            ByteBuffer reuseBuffer = ByteBuffer.allocateDirect(MESSAGE_SIZE);
            
            while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
                Message msg = sub.nextMessage(Duration.ofMillis(1000));
                if (msg != null) {
                    reuseBuffer.clear();
                    reuseBuffer.put(msg.getData());
                    reuseBuffer.flip();
                    reuseMessage.readFrom(reuseBuffer);
                    while (!buffer.write(reuseMessage)) {
                        if (Thread.currentThread().isInterrupted()) {
                            return;
                        }
                        Thread.yield();
                    }
                    msg.ack();
                    if (++i % 10000 == 0) {
                        log.debug("Consumer received {} messages", i);
                    }
                    if (reuseMessage.getSeqNo() == NUM_MESSAGES - 1) {
                        log.info("Received last message with seqNo: {}. Initiating shutdown.", reuseMessage.getSeqNo());
                        shutdownSignal.set(true);
                        break;
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error in consumer thread", e);
        }
        log.info("Consumer thread exiting. Received {} messages", i);
    }

    private static void produceMessagesCore(Connection nc, RingBuffer<LatencyMessage> buffer, String subject) {
        log.info("Starting NATS core producer thread");
        int i = 0;
        while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
            LatencyMessage message = buffer.read();
            if (message != null) {
                try {
                    ByteBuffer byteBuffer = preAllocatedBuffers[(int) message.getSeqNo()];
                    byteBuffer.clear();
                    message.writeTo(byteBuffer);
                    byteBuffer.flip();
                    byte[] data = new byte[byteBuffer.remaining()];
                    byteBuffer.get(data);
                    nc.publish(subject, data);
                    if (++i % 10000 == 0) {
                        log.debug("NATS core producer published {} messages", i);
                    }
                } catch (Exception e) {
                    log.error("Error publishing message", e);
                }
            } else {
                Thread.yield();
            }
        }
        log.info("NATS core producer thread exiting. Published {} messages", i);
    }

    private static void consumeMessagesCore(Connection nc, RingBuffer<LatencyMessage> buffer, String subject) {
        log.info("Starting NATS core consumer thread");
        try {
            Subscription sub = nc.subscribe(subject);
            
            LatencyMessage reuseMessage = new LatencyMessage();
            ByteBuffer reuseBuffer = ByteBuffer.allocateDirect(MESSAGE_SIZE);
            
            int i = 0;
            while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
                Message msg = sub.nextMessage(Duration.ofMillis(1000));
                if (msg != null) {
                    reuseBuffer.clear();
                    reuseBuffer.put(msg.getData());
                    reuseBuffer.flip();
                    reuseMessage.readFrom(reuseBuffer);
                    while (!buffer.write(reuseMessage)) {
                        if (Thread.currentThread().isInterrupted()) {
                            return;
                        }
                        Thread.yield();
                    }
                    if (++i % 10000 == 0) {
                        log.debug("NATS core consumer received {} messages", i);
                    }
                    if (reuseMessage.getSeqNo() == NUM_MESSAGES - 1) {
                        log.info("Received last message with seqNo: {}. Initiating shutdown.", reuseMessage.getSeqNo());
                        shutdownSignal.set(true);
                        break;
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error in NATS core consumer thread", e);
        } finally {
            // Remove the following line:
            // completionLatch.countDown();
        }
        log.info("NATS core consumer thread exiting.");
    }
}