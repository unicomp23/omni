package com.example.kafka;

import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Properties;
import java.util.concurrent.Future;

public class KafkaProducer {
    private static final Logger logger = LoggerFactory.getLogger(KafkaProducer.class);
    private static final String TOPIC = "test-topic";
    private static final String BOOTSTRAP_SERVERS = "kafka4:29092";

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.RETRIES_CONFIG, 0);
        props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384);
        props.put(ProducerConfig.LINGER_MS_CONFIG, 1);
        props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, 33554432);

        try (Producer<String, String> producer = new org.apache.kafka.clients.producer.KafkaProducer<>(props)) {
            logger.info("Starting Java Kafka Producer...");

            for (int i = 1; i <= 5; i++) {
                String key = "java-key-" + i;
                String timestamp = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
                String value = String.format("Java Producer Message %d - %s", i, timestamp);

                ProducerRecord<String, String> record = new ProducerRecord<>(TOPIC, key, value);

                try {
                    Future<RecordMetadata> future = producer.send(record);
                    RecordMetadata metadata = future.get();
                    
                    logger.info("Sent message: Key={}, Value={}", key, value);
                    logger.info("  -> Partition: {}, Offset: {}", metadata.partition(), metadata.offset());
                    
                    // Sleep for 1 second
                    Thread.sleep(1000);
                    
                } catch (Exception e) {
                    logger.error("Error sending message {}: {}", i, e.getMessage(), e);
                }
            }
            
            logger.info("Java Producer completed successfully!");
            
        } catch (Exception e) {
            logger.error("Producer error: {}", e.getMessage(), e);
        }
    }
} 