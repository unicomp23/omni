package com.cantina.msklatency;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReferenceArray;

public class RingBuffer<T> {
    private final AtomicReferenceArray<T> buffer;
    private final AtomicInteger head;
    private final AtomicInteger tail;
    private final int capacity;
    private AtomicInteger count;

    public RingBuffer(int capacity) {
        this.capacity = capacity;
        this.buffer = new AtomicReferenceArray<>(capacity);
        this.head = new AtomicInteger(0);
        this.tail = new AtomicInteger(0);
        this.count = new AtomicInteger(0);
    }

    public boolean write(T element) {
        int currentTail = tail.get();
        int nextTail = (currentTail + 1) % capacity;
        if (nextTail == head.get()) {
            return false; // Buffer is full
        }
        buffer.set(currentTail, element);
        tail.set(nextTail);
        count.incrementAndGet();
        return true;
    }

    public T read() {
        int currentHead = head.get();
        if (currentHead == tail.get()) {
            return null; // Buffer is empty
        }
        T element = buffer.get(currentHead);
        head.set((currentHead + 1) % capacity);
        count.decrementAndGet();
        return element;
    }

    public int size() {
        return count.get();
    }
}