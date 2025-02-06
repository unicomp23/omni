package com.cantina.msklatency;

import org.apache.kafka.common.serialization.Deserializer;
import java.nio.ByteBuffer;

public class LatencyMessageDeserializer implements Deserializer<LatencyMessage> {
    @Override
    public LatencyMessage deserialize(String topic, byte[] data) {
        if (data == null) {
            return null;
        }
        LatencyMessage message = new LatencyMessage();
        ByteBuffer buffer = ByteBuffer.wrap(data);
        message.readFrom(buffer);
        return message;
    }
}