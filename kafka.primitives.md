## Kafka Primitives

```mermaid
flowchart TD
    PartitionCount_(PartitionCount) --> TopicConfig_
    TopicConfig_(TopicConfig) --> Kafka_
    Producer_(ProducerPublisher) --> PartitionKey_
    PartitionKey_(PartitionKey) -->|murmur_hash| Kafka_{Kafka}
    Kafka_ --> ConsumerGroup_(ConsumerGroup)
    ConsumerGroup_ -->|partition_indexes| Worker_1(SubscriberWorker)
    ConsumerGroup_ -->|partition_indexes| Worker_2(SubscriberWorker)
    ConsumerGroup_ -->|partition_indexes| Worker_3(SubscriberWorker)
    Worker_1 -->|subscribe| ConsumerGroup_
    Worker_2 -->|subscribe| ConsumerGroup_
    Worker_3 -->|subscribe| ConsumerGroup_
```

For example:<br/>
<br/>
PartitionCount, for topic config, is 1000.<br/>
PartitionKey = "appid/123/chanid/322/userid/user42"  (each PartitionKey carries a payload as well)
<br/>
int32 hash = murmur_hash(PartitionKey)<br/>
partition_index = hash % PartitionCount<br/>
<br/>
<br/>
Here we have three workers, so 1000/3 = ~333 partition_indexes per worker.
If worker count increased to 250, that would mean 1000/4 = 250 partitions per worker,
after the ConsumerGroup is rebalanced.
