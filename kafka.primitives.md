## Kafka Primitives

```mermaid
flowchart TD
    PartitionCount_(PartitionCount) --> TopicConfig_
    TopicConfig_(TopicConfig) --> Kafka_
    RaiseHandApi_(RaiseHandApi) -->|raise_hand_event<br>appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| Producer_
    Producer_(ProducerPublisher) --> PartitionKey_
    PartitionKey_(PartitionKey) -->|murmur_hash| Kafka_{Kafka}
    Kafka_ --> ConsumerGroup_(ConsumerGroup)
    ConsumerGroup_ -->|partition_indexes| ConsumerGroupSubscriber_1(ConsumerGroupSubscriber)
    ConsumerGroup_ -->|partition_indexes| ConsumerGroupSubscriber_2(ConsumerGroupSubscriber)
    ConsumerGroup_ -->|partition_indexes| ConsumerGroupSubscriber_3(ConsumerGroupSubscriber)
    ConsumerGroupSubscriber_1 -->|subscribe| ConsumerGroup_
    ConsumerGroupSubscriber_2 -->|subscribe| ConsumerGroup_
    ConsumerGroupSubscriber_3 -->|subscribe| ConsumerGroup_
    ConsumerGroupSubscriber_1 -->|raise_hand_event<br>appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| Worker_1(Worker)
    ConsumerGroupSubscriber_2 -->|raise_hand_event<br>appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| Worker_2(Worker)
    ConsumerGroupSubscriber_3 -->|raise_hand_event<br>appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| Worker_3(Worker)
    Worker_1 -->|appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| S3_1(S3)
    Worker_2 -->|appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| S3_2(S3)
    Worker_3 -->|appid/xxx/chanid/xxx/userid/xxx<br>handUpDown:xxx| S3_3(S3)
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
