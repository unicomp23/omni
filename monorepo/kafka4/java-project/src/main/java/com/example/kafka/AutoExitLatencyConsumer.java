package com.example.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.common.serialization.StringDeserializer;

import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.Properties;

public class AutoExitLatencyConsumer {
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";
    private static final String TOPIC = System.getenv("JAVA_LATENCY_TOPIC") != null ? 
        System.getenv("JAVA_LATENCY_TOPIC") : "latency-topic";
    private static final String GROUP_ID = "java-auto-exit-consumer-group";
    private static final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    public static class MessagePayload {
        public String id;
        public String content;
        public Instant sentAt;
        public String producer;

        public MessagePayload() {}
    }

    public static class LatencyRecord {
        public String messageId;
        public String producer;
        public String consumer;
        public Instant sentAt;
        public Instant receivedAt;
        public double latencyMs;
        public long latencyNanos;
        public String topic;
        public int partition;
        public long offset;
        public long kafkaTimestamp;

        public LatencyRecord() {}

        public LatencyRecord(String messageId, String producer, String consumer, 
                           Instant sentAt, Instant receivedAt, double latencyMs, 
                           long latencyNanos, String topic, int partition, 
                           long offset, long kafkaTimestamp) {
            this.messageId = messageId;
            this.producer = producer;
            this.consumer = consumer;
            this.sentAt = sentAt;
            this.receivedAt = receivedAt;
            this.latencyMs = latencyMs;
            this.latencyNanos = latencyNanos;
            this.topic = topic;
            this.partition = partition;
            this.offset = offset;
            this.kafkaTimestamp = kafkaTimestamp;
        }
    }

    public static void main(String[] args) {
        // Get expected message count from environment
        int expectedCount = 10; // default
        String countStr = System.getenv("EXPECTED_MESSAGE_COUNT");
        if (countStr != null && !countStr.isEmpty()) {
            try {
                expectedCount = Integer.parseInt(countStr);
            } catch (NumberFormatException e) {
                System.err.println("Invalid EXPECTED_MESSAGE_COUNT: " + countStr + ", using default: " + expectedCount);
            }
        }

        // Get timeout from environment (in seconds)
        int timeoutSeconds = 30; // default
        String timeoutStr = System.getenv("CONSUMER_TIMEOUT_SECONDS");
        if (timeoutStr != null && !timeoutStr.isEmpty()) {
            try {
                timeoutSeconds = Integer.parseInt(timeoutStr);
            } catch (NumberFormatException e) {
                System.err.println("Invalid CONSUMER_TIMEOUT_SECONDS: " + timeoutStr + ", using default: " + timeoutSeconds);
            }
        }

        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        String consumerID = "java-auto-exit-consumer";
        System.err.println("Starting Java Auto-Exit Latency Consumer...");
        System.err.println("Consumer: " + consumerID);
        System.err.println("Topic: " + TOPIC);
        System.err.println("Expected messages: " + expectedCount);
        System.err.println("Timeout: " + timeoutSeconds + " seconds");
        System.err.println("Writing latency logs to stdout in JSONL format");
        System.err.println("---");

        try (Consumer<String, String> consumer = new org.apache.kafka.clients.consumer.KafkaConsumer<>(props)) {
            consumer.subscribe(Collections.singletonList(TOPIC));

            int messageCount = 0;
            long startTime = System.currentTimeMillis();
            long lastMessageTime = startTime;
            long timeoutMs = timeoutSeconds * 1000L;
            long idleTimeoutMs = 5000L; // 5 seconds idle timeout after first message

            while (true) {
                long currentTime = System.currentTimeMillis();
                
                // Check for overall timeout
                if (currentTime - startTime > timeoutMs) {
                    System.err.println("Overall timeout reached after " + timeoutSeconds + " seconds. " +
                        "Processed " + messageCount + "/" + expectedCount + " messages.");
                    break;
                }

                // Check for idle timeout (no messages for 5 seconds after receiving first message)
                if (messageCount > 0 && currentTime - lastMessageTime > idleTimeoutMs) {
                    System.err.println("Idle timeout reached. No messages for 5 seconds. " +
                        "Processed " + messageCount + "/" + expectedCount + " messages.");
                    break;
                }

                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
                
                if (records.isEmpty()) {
                    continue;
                }

                for (ConsumerRecord<String, String> record : records) {
                    Instant receivedAt = Instant.now();
                    messageCount++;
                    lastMessageTime = System.currentTimeMillis();

                    try {
                        // Parse the message payload
                        MessagePayload payload = objectMapper.readValue(record.value(), MessagePayload.class);

                        // Calculate latency
                        Duration latency = Duration.between(payload.sentAt, receivedAt);
                        double latencyMs = latency.toNanos() / 1_000_000.0;

                        // Create latency record
                        LatencyRecord latencyRecord = new LatencyRecord(
                            payload.id,
                            payload.producer,
                            consumerID,
                            payload.sentAt,
                            receivedAt,
                            latencyMs,
                            latency.toNanos(),
                            record.topic(),
                            record.partition(),
                            record.offset(),
                            record.timestamp()
                        );

                        // Output JSONL record to stdout
                        String jsonLine = objectMapper.writeValueAsString(latencyRecord);
                        System.out.println(jsonLine);

                        // Log to stderr for debugging
                        System.err.printf("Processed: %s, Latency: %.3f ms [%d/%d]%n", 
                            payload.id, latencyMs, messageCount, expectedCount);
                        
                    } catch (Exception e) {
                        System.err.println("Error processing message: " + e.getMessage());
                        e.printStackTrace();
                    }
                }

                // Exit when we've received the expected number of messages
                if (messageCount >= expectedCount) {
                    System.err.println("Received expected " + expectedCount + " messages. Exiting successfully.");
                    break;
                }
            }

            long duration = System.currentTimeMillis() - startTime;
            System.err.println("Java Auto-Exit Consumer completed! Processed " + messageCount + 
                " messages in " + duration + "ms.");
            
        } catch (Exception e) {
            System.err.println("Consumer error: " + e.getMessage());
            e.printStackTrace();
        }
    }
} 