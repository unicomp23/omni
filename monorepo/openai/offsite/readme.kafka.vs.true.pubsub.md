Kafka PubSub:

```mermaid
graph LR
    P(Kafka Publisher) -- message --> B[Kafka Topic]
    B -- message --> S1[Kafka Consumer Group]
    B -- message --> S2[Kafka Consumer Group]
    B -- message --> S3[Kafka Consumer Group]
    S1 -- message --> C1_1[Consumer 1.1]
    S2 -- message --> C2_1[Consumer 2.1]
    S3 -- message --> C3_1[Consumer 3.1]
```

Regular PubSub (ActiveMQ):

```mermaid
graph LR
    P(ActiveMQ Publisher) -- message --> B[ActiveMQ Topic]
    B -- message --> S1[Subscriber 1]
    B -- message --> S2[Subscriber 2]
    B -- message --> S3[Subscriber 3]
```

In Kafka PubSub, the messages are published to topics, and each consumer group has at least one consumer. Each message is consumed by only one consumer within a consumer group. Multiple consumer groups can receive the published message, allowing parallel processing.

In the case of Regular PubSub (ActiveMQ), messages are published to a topic, and all subscribers receive the message.
