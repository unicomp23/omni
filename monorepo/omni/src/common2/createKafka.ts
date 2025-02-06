import {Kafka} from "kafkajs";
import {kafkaLogLevel} from "../kafka/constants";
import {env} from "process";
import {createMechanism} from "@jm18457/kafkajs-msk-iam-authentication-mechanism";

export function createKafka(clientId: string, region: string = 'us-east-1'): Kafka {
    console.log("createKafka: env.KAFKA_BROKERS: ", env.KAFKA_BROKERS);
    if(env.KAFKA_BROKERS?.search('redpanda') === -1) {
        return new Kafka({
            clientId,
            brokers: env.KAFKA_BROKERS?.split(',') || [],
            logLevel: kafkaLogLevel,
            ssl: true,
            sasl: createMechanism({ region }),
        });
    }
    return new Kafka({
        clientId,
        brokers: ['redpanda:9092'],
        logLevel: kafkaLogLevel,
    });
}
