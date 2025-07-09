package com.example.kafka;

import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.common.serialization.StringDeserializer;

import java.time.Duration;
import java.util.Collections;
import java.util.Properties;

public class SimpleConsumer {
    private static final String TOPIC = "test-topic";
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";
    private static final String GROUP_ID = "simple-java-consumer-group";

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        System.out.println("Starting Simple Java Kafka Consumer...");

        try (Consumer<String, String> consumer = new org.apache.kafka.clients.consumer.KafkaConsumer<>(props)) {
            consumer.subscribe(Collections.singletonList(TOPIC));
            System.out.println("Subscribed to topic: " + TOPIC);

            int messageCount = 0;
            long startTime = System.currentTimeMillis();
            long timeout = 10000; // 10 seconds timeout

            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
                
                if (records.isEmpty()) {
                    if (System.currentTimeMillis() - startTime > timeout) {
                        System.out.println("Timeout reached. Stopping consumer.");
                        break;
                    }
                    continue;
                }

                for (ConsumerRecord<String, String> record : records) {
                    messageCount++;
                    System.out.println("Message #" + messageCount + ":");
                    System.out.println("  Key: " + (record.key() != null ? record.key() : "null"));
                    System.out.println("  Value: " + record.value());
                    System.out.println("  Partition: " + record.partition() + ", Offset: " + record.offset());
                    System.out.println("---");
                    
                    startTime = System.currentTimeMillis(); // Reset timeout
                }
            }

            System.out.println("Simple Java Consumer completed! Read " + messageCount + " messages.");
            
        } catch (Exception e) {
            System.err.println("Consumer error: " + e.getMessage());
            e.printStackTrace();
        }
    }
} 