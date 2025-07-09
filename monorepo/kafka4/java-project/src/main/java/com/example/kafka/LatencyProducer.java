package com.example.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.serialization.StringSerializer;

import java.time.Instant;
import java.util.Properties;
import java.util.concurrent.Future;

public class LatencyProducer {
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";
    private static final String TOPIC = System.getenv("JAVA_LATENCY_TOPIC") != null ? 
        System.getenv("JAVA_LATENCY_TOPIC") : "latency-topic";
    private static final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    public static class MessagePayload {
        public String id;
        public String content;
        public Instant sentAt;
        public String producer;

        public MessagePayload() {}

        public MessagePayload(String id, String content, Instant sentAt, String producer) {
            this.id = id;
            this.content = content;
            this.sentAt = sentAt;
            this.producer = producer;
        }
    }

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");

        String producerID = "java-latency-producer";
        System.out.println("Starting Java Latency Producer...");
        System.out.println("Producer: " + producerID);
        System.out.println("Topic: " + TOPIC);

        try (Producer<String, String> producer = new org.apache.kafka.clients.producer.KafkaProducer<>(props)) {
            
            for (int i = 1; i <= 10; i++) {
                MessagePayload payload = new MessagePayload(
                    "java-msg-" + i,
                    "Java latency test message " + i,
                    Instant.now(),
                    producerID
                );

                try {
                    String payloadJson = objectMapper.writeValueAsString(payload);
                    ProducerRecord<String, String> record = new ProducerRecord<>(TOPIC, payload.id, payloadJson);

                    Future<RecordMetadata> future = producer.send(record);
                    RecordMetadata metadata = future.get();
                    
                    System.out.println("Sent: " + payload.id + " at " + payload.sentAt);
                    
                    Thread.sleep(500);
                    
                } catch (Exception e) {
                    System.err.println("Error sending message " + i + ": " + e.getMessage());
                    e.printStackTrace();
                }
            }
            
            System.out.println("Java Latency Producer completed!");
            
        } catch (Exception e) {
            System.err.println("Producer error: " + e.getMessage());
            e.printStackTrace();
        }
    }
} 