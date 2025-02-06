package com.cantina.msklatency;

import org.apache.kafka.common.serialization.Serializer;
import java.nio.ByteBuffer;

public class LatencyMessageSerializer implements Serializer<LatencyMessage> {
    @Override
    public byte[] serialize(String topic, LatencyMessage data) {
        if (data == null) {
            return null;
        }
        ByteBuffer buffer = ByteBuffer.allocate(Long.BYTES * 2);
        data.writeTo(buffer);
        return buffer.array();
    }
}