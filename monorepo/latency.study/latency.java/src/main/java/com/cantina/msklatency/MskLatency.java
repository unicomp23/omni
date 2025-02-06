package com.cantina.msklatency;

import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class MskLatency {
    private static final Logger log = LoggerFactory.getLogger(MskLatency.class);
    private static final int NUM_MESSAGES = 1000000;
    private static final String TOPIC_PREFIX = "latency-test-";
    private static final String REDPANDA_HOST = "redpanda:29092";
    private static final int BUFFER_SIZE = 10000;
    private static final long TIMEOUT_MS = 300000; // 5 minutes
    private static final AtomicBoolean shutdownSignal = new AtomicBoolean(false);

    private static final int MESSAGE_SIZE = Long.BYTES * 2; // timestamp + seqNo
    private static final LatencyMessage[] preAllocatedMessages = new LatencyMessage[NUM_MESSAGES];
    private static final ByteBuffer[] preAllocatedBuffers = new ByteBuffer[NUM_MESSAGES];
    private static final long[] latencies = new long[NUM_MESSAGES];

    private static void printResolvedAddresses(String host) {
        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            System.out.println("Resolved addresses for " + host + ":");
            for (InetAddress address : addresses) {
                System.out.println(address.getHostAddress());
            }
        } catch (UnknownHostException e) {
            System.out.println("Could not resolve " + host + ": " + e.getMessage());
        }
    }

    public static void run(String[] args) {
        if (args.length > 0 && (args[0].equals("-h") || args[0].equals("--help"))) {
            printUsage();
            return;
        }

        printResolvedAddresses("redpanda");
        System.out.println("REDPANDA_HOST: " + REDPANDA_HOST);
        String topic = TOPIC_PREFIX + UUID.randomUUID().toString();
        log.info("Using topic: {} and connecting to Redpanda at: {}", topic, REDPANDA_HOST);

        // Kafka producer configuration
        Properties producerProps = new Properties();
        producerProps.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, REDPANDA_HOST);
        producerProps.put(ProducerConfig.CLIENT_DNS_LOOKUP_CONFIG, "use_all_dns_ips");
        producerProps.put(ProducerConfig.RECONNECT_BACKOFF_MAX_MS_CONFIG, "10000");
        producerProps.put("key.serializer", StringSerializer.class.getName());
        producerProps.put("value.serializer", LatencyMessageSerializer.class.getName());
        // Added configurations
        producerProps.put("enable.idempotence", "true");
        producerProps.put("acks", "all");
        producerProps.put("linger.ms", "1");
        producerProps.put("max.in.flight.requests.per.connection", "5");

        // Kafka consumer configuration
        Properties consumerProps = new Properties();
        consumerProps.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, REDPANDA_HOST);
        consumerProps.put(ConsumerConfig.CLIENT_DNS_LOOKUP_CONFIG, "use_all_dns_ips");
        consumerProps.put(ConsumerConfig.RECONNECT_BACKOFF_MAX_MS_CONFIG, "10000");
        consumerProps.put("group.id", "latency-test-group-" + UUID.randomUUID().toString());
        consumerProps.put("key.deserializer", StringDeserializer.class.getName());
        consumerProps.put("value.deserializer", LatencyMessageDeserializer.class.getName());
        consumerProps.put("auto.offset.reset", "earliest");
        // Added configuration
        consumerProps.put("enable.auto.commit", "false");

        RingBuffer<LatencyMessage> producerBuffer = new RingBuffer<>(BUFFER_SIZE);
        RingBuffer<LatencyMessage> consumerBuffer = new RingBuffer<>(BUFFER_SIZE);

        // Pre-allocate messages and byte buffers
        for (int i = 0; i < NUM_MESSAGES; i++) {
            preAllocatedMessages[i] = new LatencyMessage();
            preAllocatedMessages[i].set(0, i);
            preAllocatedBuffers[i] = ByteBuffer.allocateDirect(MESSAGE_SIZE);
        }

        try (KafkaProducer<String, LatencyMessage> producer = new KafkaProducer<>(producerProps);
             KafkaConsumer<String, LatencyMessage> consumer = new KafkaConsumer<>(consumerProps)) {
            
            log.info("Created producer and consumer");
            consumer.subscribe(Collections.singletonList(topic));
            log.info("Subscribed to topic: {}", topic);

            ExecutorService executorService = Executors.newFixedThreadPool(2);
            Future<?> producerFuture = executorService.submit(() -> produceMessages(producer, producerBuffer, topic));
            Future<?> consumerFuture = executorService.submit(() -> consumeMessages(consumer, consumerBuffer));

            long totalLatency = 0;
            int receivedMessages = 0;

            // Produce and consume messages
            long startTime = System.currentTimeMillis();
            for (int i = 0; i < NUM_MESSAGES && !shutdownSignal.get(); i++) {
                long startTimeNano = System.nanoTime();
                LatencyMessage message = preAllocatedMessages[i];
                message.setTimestamp(startTimeNano);  // Assuming we add a setter for timestamp
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
                    latencies[receivedMessages] = latency;
                    totalLatency += latency;
                    receivedMessages++;
                }

                if (i % 100000 == 0) {
                    System.out.printf("Processed %d messages%n", i);
                }

                if (System.currentTimeMillis() - startTime > TIMEOUT_MS) {
                    log.warn("Timeout reached after processing {} messages", i);
                    break;
                }
            }

            // Consume any remaining messages
            while (receivedMessages < NUM_MESSAGES) {
                LatencyMessage message = consumerBuffer.read();
                if (message != null) {
                    long latency = System.nanoTime() - message.getTimestamp();
                    latencies[receivedMessages] = latency;
                    totalLatency += latency;
                    receivedMessages++;
                } else {
                    Thread.yield();
                }
            }

            // Wait for threads to finish
            shutdownSignal.set(true);
            try {
                producerFuture.get(30, TimeUnit.SECONDS);
                consumerFuture.get(30, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                log.warn("Timeout waiting for producer or consumer to finish");
            } finally {
                executorService.shutdownNow();
            }

            double avgLatency = totalLatency / (double) NUM_MESSAGES;
            System.out.printf("Average Kafka latency: %.2f ns%n", avgLatency);

            // Calculate and print percentiles
            Arrays.sort(latencies, 0, receivedMessages);
            System.out.println("Latency percentiles:");
            System.out.printf("50th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 50) / 1_000_000.0);
            System.out.printf("90th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 90) / 1_000_000.0);
            System.out.printf("95th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 95) / 1_000_000.0);
            System.out.printf("99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99) / 1_000_000.0);
            System.out.printf("99.9th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.9) / 1_000_000.0);
            System.out.printf("99.99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.99) / 1_000_000.0);
        } catch (Exception e) {
            log.error("Error occurred: ", e);
        }
    }

    private static void printUsage() {
        System.out.println("Usage: java -jar msklatency.jar [options]");
        System.out.println("Options:");
        System.out.println("  -h, --help    Show this help message");
        System.out.println();
        System.out.println("This program measures the latency of sending and receiving messages through Apache Kafka.");
        System.out.println("It will send " + NUM_MESSAGES + " messages and calculate various latency percentiles.");
    }

    private static void produceMessages(KafkaProducer<String, LatencyMessage> producer, RingBuffer<LatencyMessage> buffer, String topic) {
        while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
            LatencyMessage message = buffer.read();
            if (message != null) {
                ByteBuffer byteBuffer = preAllocatedBuffers[(int) message.getSeqNo()];
                byteBuffer.clear();
                message.writeTo(byteBuffer);
                byteBuffer.flip();
                producer.send(new ProducerRecord<>(topic, message));
            } else {
                Thread.yield();
            }
        }
        producer.flush();
        log.info("Producer thread exiting.");
    }

    private static void consumeMessages(KafkaConsumer<String, LatencyMessage> consumer, RingBuffer<LatencyMessage> buffer) {
        long expectedSeqNo = 0;
        long lastLogTime = System.currentTimeMillis();
        long consumedCount = 0;
        long startTime = System.currentTimeMillis();

        while (!Thread.currentThread().isInterrupted() && !shutdownSignal.get()) {
            try {
                ConsumerRecords<String, LatencyMessage> records = consumer.poll(Duration.ofMillis(1));
                //log.info("Polled {} records", records.count());

                for (ConsumerRecord<String, LatencyMessage> record : records) {
                    LatencyMessage message = record.value();
                    if (message.getSeqNo() != expectedSeqNo) {
                        log.warn("Sequence number mismatch. Expected: {}, Received: {}", expectedSeqNo, message.getSeqNo());
                    }
                    expectedSeqNo++;
                    while (!buffer.write(message)) {
                        if (Thread.currentThread().isInterrupted()) {
                            return;
                        }
                        Thread.yield();
                    }
                    consumedCount++;
                    
                    if (message.getSeqNo() == NUM_MESSAGES - 1) {
                        log.info("Received last message with seqNo: {}. Initiating shutdown.", message.getSeqNo());
                        shutdownSignal.set(true);
                        break;
                    }
                }
                
                if (consumedCount % 10000 == 0 || System.currentTimeMillis() - lastLogTime > 5000) {
                    long now = System.currentTimeMillis();
                    log.info("Consumed {} messages. Last batch took {} ms. Buffer size: {}", 
                             consumedCount, now - lastLogTime, buffer.size());
                    lastLogTime = now;
                }

                if (shutdownSignal.get()) {
                    log.info("Shutdown signal received. Finishing up and exiting consumer.");
                    // Process any remaining messages in the buffer
                    while (buffer.size() > 0) {
                        // Process remaining messages
                    }
                    break;
                }

                if (System.currentTimeMillis() - startTime > TIMEOUT_MS) {
                    log.warn("Timeout reached. Consumed {} messages before timing out.", consumedCount);
                    break;
                }
            } catch (Exception e) {
                log.error("Error in consumer thread", e);
            }
        }
        log.info("Consumer thread exiting.");
    }

    private static long calculatePercentile(long[] sortedLatencies, int size, double percentile) {
        int index = (int) Math.ceil(percentile / 100.0 * size) - 1;
        return sortedLatencies[Math.min(index, size - 1)];
    }
}