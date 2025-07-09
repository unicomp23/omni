package com.example.kafka;

import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.serialization.StringSerializer;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Properties;
import java.util.concurrent.Future;

public class SimpleProducer {
    private static final String TOPIC = "test-topic";
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");

        System.out.println("Starting Simple Java Kafka Producer...");

        try (Producer<String, String> producer = new org.apache.kafka.clients.producer.KafkaProducer<>(props)) {
            for (int i = 1; i <= 5; i++) {
                String key = "simple-java-key-" + i;
                String timestamp = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
                String value = String.format("Simple Java Producer Message %d - %s", i, timestamp);

                ProducerRecord<String, String> record = new ProducerRecord<>(TOPIC, key, value);

                try {
                    Future<RecordMetadata> future = producer.send(record);
                    RecordMetadata metadata = future.get();
                    
                    System.out.println("Sent: " + value);
                    System.out.println("  -> Partition: " + metadata.partition() + ", Offset: " + metadata.offset());
                    
                    Thread.sleep(1000);
                    
                } catch (Exception e) {
                    System.err.println("Error sending message " + i + ": " + e.getMessage());
                    e.printStackTrace();
                }
            }
            
            System.out.println("Simple Java Producer completed successfully!");
            
        } catch (Exception e) {
            System.err.println("Producer error: " + e.getMessage());
            e.printStackTrace();
        }
    }
} 