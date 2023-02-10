## Async notifications architecture

```mermaid
flowchart TD
    Kafka_{Kafka} -->PubSubApi_(PubSubApi)
    PubSubApi_ -->Kafka_
    Vandenberg_(Vandenberg) -->|publish-recording-start| PubSubApi_
    PubSubApi_ -->|notify-recording-start| StreamNotifier_(StreamNotifier)
    StreamNotifier_ -->|subscribe-recording-start| PubSubApi_
    Client_(Client) -->|listener-registration| StreamNotifier_
    StreamNotifier_ -->|recording-start-event| Client_
```
<br/>
