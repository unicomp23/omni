package com.cantina.msklatency;

import java.io.IOException;

public class EntryPoint {
    public static void main(String[] args) {
        if (args.length > 0) {
            switch (args[0].toLowerCase()) {
                case "pingpong":
                    PingPong.run(args);
                    break;
                case "msklatency":
                    MskLatency.run(args);
                    break;
                case "natslatency":
                    if (args.length < 2) {
                        System.out.println("Please specify NATS mode: 'core' or 'js' (for JetStream)");
                    } else {
                        try {
                            NatsLatency.run(args[1]);
                        } catch (IOException | InterruptedException e) {
                            System.err.println("Error running NatsLatency: " + e.getMessage());
                            e.printStackTrace();
                        }
                    }
                    break;
                default:
                    System.out.println("Invalid argument. Use 'pingpong', 'msklatency', or 'natslatency'.");
            }
        } else {
            System.out.println("Please provide an argument: 'pingpong', 'msklatency', or 'natslatency'.");
        }
    }
}