package com.cantina.msklatency;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.*;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

public class PingPong {
    private static final Logger log = LoggerFactory.getLogger(PingPong.class);
    private static final int NUM_MESSAGES = 1000000;
    private static final long TIMEOUT_MS = 300000; // 5 minutes
    private static final AtomicBoolean shutdownSignal = new AtomicBoolean(false);

    private static final long[] latencies = new long[NUM_MESSAGES];

    public static void run(String[] args) {
        if (args.length != 3) {
            System.out.println("Usage: java -jar <jar-file> pingpong <mode> <port>");
            System.out.println("mode: 'server' or 'client'");
            System.out.println("port: UDP port number");
            return;
        }

        String mode = args[1];
        int port = Integer.parseInt(args[2]);

        try {
            if ("server".equalsIgnoreCase(mode)) {
                runServer(port);
            } else if ("client".equalsIgnoreCase(mode)) {
                runClient("localhost", port);
            } else {
                System.out.println("Invalid mode. Use 'server' or 'client'.");
            }
        } catch (Exception e) {
            log.error("Error occurred: ", e);
        }
    }

    private static void runServer(int port) throws Exception {
        DatagramSocket socket = new DatagramSocket(port);
        log.info("UDP Server listening on port {}", port);

        byte[] receiveBuffer = new byte[Long.BYTES + Integer.BYTES];
        DatagramPacket receivePacket = new DatagramPacket(receiveBuffer, receiveBuffer.length);

        while (!shutdownSignal.get()) {
            socket.receive(receivePacket);
            ByteBuffer buffer = ByteBuffer.wrap(receivePacket.getData());
            int seqNo = buffer.getInt();

            // Echo the packet back
            socket.send(new DatagramPacket(receiveBuffer, receiveBuffer.length, receivePacket.getAddress(), receivePacket.getPort()));

            if (seqNo == NUM_MESSAGES - 1) {
                log.info("Received last message with seqNo: {}. Shutting down server.", seqNo);
                break;
            }
        }

        socket.close();
        log.info("Server shut down.");
    }

    private static void runClient(String serverHost, int serverPort) throws Exception {
        DatagramSocket socket = new DatagramSocket();
        InetAddress serverAddress = InetAddress.getByName(serverHost);
        log.info("UDP Client connecting to {}:{}", serverHost, serverPort);

        byte[] sendBuffer = new byte[Long.BYTES + Integer.BYTES];
        DatagramPacket sendPacket = new DatagramPacket(sendBuffer, sendBuffer.length, serverAddress, serverPort);

        byte[] receiveBuffer = new byte[Long.BYTES + Integer.BYTES];
        DatagramPacket receivePacket = new DatagramPacket(receiveBuffer, receiveBuffer.length);

        long totalLatency = 0;
        int receivedMessages = 0;

        long startTime = System.currentTimeMillis();
        for (int i = 0; i < NUM_MESSAGES && !shutdownSignal.get(); i++) {
            long startTimeNano = System.nanoTime();
            ByteBuffer buffer = ByteBuffer.wrap(sendBuffer);
            buffer.putLong(startTimeNano);
            buffer.putInt(i);

            socket.send(sendPacket);
            socket.receive(receivePacket);

            long latency = System.nanoTime() - startTimeNano;
            latencies[receivedMessages] = latency;
            totalLatency += latency;
            receivedMessages++;

            if (i % 100000 == 0) {
                System.out.printf("Processed %d messages%n", i);
            }

            if (System.currentTimeMillis() - startTime > TIMEOUT_MS) {
                log.warn("Timeout reached after processing {} messages", i);
                break;
            }
        }

        socket.close();

        double avgLatency = totalLatency / (double) NUM_MESSAGES;
        System.out.printf("Average UDP latency: %.2f ns%n", avgLatency);

        // Calculate and print percentiles
        Arrays.sort(latencies, 0, receivedMessages);
        System.out.println("Latency percentiles:");
        System.out.printf("50th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 50) / 1_000_000.0);
        System.out.printf("90th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 90) / 1_000_000.0);
        System.out.printf("95th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 95) / 1_000_000.0);
        System.out.printf("99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99) / 1_000_000.0);
        System.out.printf("99.9th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.9) / 1_000_000.0);
        System.out.printf("99.99th percentile: %.3f ms%n", calculatePercentile(latencies, receivedMessages, 99.99) / 1_000_000.0);
    }

    private static long calculatePercentile(long[] sortedLatencies, int size, double percentile) {
        int index = (int) Math.ceil(percentile / 100.0 * size) - 1;
        return sortedLatencies[Math.min(index, size - 1)];
    }
}