package com.cantina.msklatency;

import java.nio.ByteBuffer;

public class LatencyMessage {
    private long timestamp;
    private long seqNo;

    public LatencyMessage() {
        // Empty constructor for object reuse
    }

    public void set(long timestamp, long seqNo) {
        this.timestamp = timestamp;
        this.seqNo = seqNo;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }

    public long getSeqNo() {
        return seqNo;
    }

    public void writeTo(ByteBuffer buffer) {
        buffer.putLong(timestamp);
        buffer.putLong(seqNo);
    }

    public void readFrom(ByteBuffer buffer) {
        timestamp = buffer.getLong();
        seqNo = buffer.getLong();
    }
}