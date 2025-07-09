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

public class LatencyConsumer {
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";
    private static final String TOPIC = System.getenv("JAVA_LATENCY_TOPIC") != null ? 
        System.getenv("JAVA_LATENCY_TOPIC") : "latency-topic";
    private static final String GROUP_ID = "java-latency-consumer-group";
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
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        String consumerID = "java-latency-consumer";
        System.err.println("Starting Java Latency Consumer...");
        System.err.println("Consumer: " + consumerID);
        System.err.println("Writing latency logs to stdout in JSONL format");
        System.err.println("---");

        try (Consumer<String, String> consumer = new org.apache.kafka.clients.consumer.KafkaConsumer<>(props)) {
            consumer.subscribe(Collections.singletonList(TOPIC));

            int messageCount = 0;
            long startTime = System.currentTimeMillis();
            long timeout = 30000; // 30 seconds timeout

            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
                
                if (records.isEmpty()) {
                    if (System.currentTimeMillis() - startTime > timeout) {
                        System.err.println("Timeout reached. Stopping consumer.");
                        break;
                    }
                    continue;
                }

                for (ConsumerRecord<String, String> record : records) {
                    Instant receivedAt = Instant.now();
                    messageCount++;

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
                        System.err.printf("Processed: %s, Latency: %.3f ms%n", payload.id, latencyMs);
                        
                        // Reset timeout when we receive messages
                        startTime = System.currentTimeMillis();
                        
                    } catch (Exception e) {
                        System.err.println("Error processing message: " + e.getMessage());
                        e.printStackTrace();
                    }
                }

                // Stop after processing some messages for demo
                if (messageCount >= 50) {
                    break;
                }
            }

            System.err.println("Java Latency Consumer completed! Processed " + messageCount + " messages.");
            
        } catch (Exception e) {
            System.err.println("Consumer error: " + e.getMessage());
            e.printStackTrace();
        }
    }
} 