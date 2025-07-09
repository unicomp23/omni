package com.example.kafka;

import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.Collections;
import java.util.Properties;

public class KafkaConsumer {
    private static final Logger logger = LoggerFactory.getLogger(KafkaConsumer.class);
    private static final String TOPIC = "test-topic";
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";
    private static final String GROUP_ID = "java-consumer-group";

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "true");
        props.put(ConsumerConfig.AUTO_COMMIT_INTERVAL_MS_CONFIG, "1000");

        try (Consumer<String, String> consumer = new org.apache.kafka.clients.consumer.KafkaConsumer<>(props)) {
            consumer.subscribe(Collections.singletonList(TOPIC));
            logger.info("Java Consumer starting, subscribed to topic: {}", TOPIC);

            int messageCount = 0;
            long startTime = System.currentTimeMillis();
            long timeout = 10000; // 10 seconds timeout

            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
                
                if (records.isEmpty()) {
                    // Check if we've exceeded the timeout
                    if (System.currentTimeMillis() - startTime > timeout) {
                        logger.info("Timeout reached. Stopping consumer.");
                        break;
                    }
                    continue;
                }

                for (ConsumerRecord<String, String> record : records) {
                    messageCount++;
                    logger.info("Received message:");
                    logger.info("  Key: {}", record.key() != null ? record.key() : "null");
                    logger.info("  Value: {}", record.value());
                    logger.info("  Partition: {}, Offset: {}", record.partition(), record.offset());
                    logger.info("  Timestamp: {}", record.timestamp());
                    logger.info("---");
                    
                    // Reset timeout when we receive messages
                    startTime = System.currentTimeMillis();
                }
            }

            logger.info("Java Consumer completed successfully! Read {} messages.", messageCount);
            
        } catch (Exception e) {
            logger.error("Consumer error: {}", e.getMessage(), e);
        }
    }
} 