## Omni pubsub

### Questions and answers

How can Vandenberg communicate with the notification system? Kafka?
> A nats-like pubsub layer, omni, which runs on top of kafka

How can we represent tag metadata in a way that's extensible to support future applications?
> Yes, simply create a new topic/partitionKey in the pubsub layer

How will multi-region deployments work? We currently host Vandenberg in all of our regions, but the master and stream
notifiers are only in us-east-1.
> Initially, in the interest of low complexity, we are shooting for a single
> kafka cluster managing all regions.

Where will tag metadata be persisted to support late joiners? The Tecate Master (serious concerns here).
> redis

We probably want recording stop events.
> Given the pubsub layer is generic, adding stop events becomes trivial.

Do we need the full pubsub API? Can Vandenberg and the stream notifier just talk to Kafka?
> If we have everyone use kafka directly, they will each end up "re-inventing"
> the generic nats-like pubsub layer in different ways. Overall lines of code
> will increase, along w/ complexity. More lines of code typically leads to
> higher defect counts, more confusion, terrible development velocity, etc.

Do we need a persistency layer so that late joiners can get the current room state?
> Redis

How can we extend this so that we can push out other types of room state?
> If the pubsub layer is generic, ie per the concept of a kafka partitionkey which
> acts like a nats pubsub topic, adding other types of room state becomes trivial.  
> See the protobuf spec we looked at earlier ie "Path" object.  (I stole this idea from Ben)

What kind of extensions will be required in the existing tecate proto spec to support these? (With an eye toward
simplicity as the guiding principle).
> My expectation would be the tecate payloads can remain "as is", they are simply  
> carried by the generic nats-like pubsub layer.

What’s the difference between the pub sub layer and kafka? What additional services does it provide?
> This might need a longer conversation. The question could be better framed as:
> what's the difference between a NATS topic and a kafka topic? Kafka subscribers
> are members of a consumer group, whereas NATS subscribers are not members of a
> consumer group. A kafka subscriber is a sharding element of the kafka consumer group.  
> A NATS subscriber does not participate as a sharding element of a topic,
> it receives everything published on the topic. Kafka is geared towards load balancing.  
> NATS is geared towards real-time pubsub messaging.

How is the pub sub layer implemented? Is it a service? A library? Something else?
> https://github.com/unicomp23/omni/blob/aec75c98de32ea4a80e7c56dafa23ceb2c85202c/proto/devinternal.proto#L144

I think we’ll need some extensions to the Tecate protocol to allow clients to receive notifications, yes? Tecate is the
only protocol they understand…
> I could be wrong, but I don't think we'll need extensions for the Tecate protocol. We will need to discuss how the
> pubsub paths/topics/partitionkeys which carry Tecate protobuf payloads will be structured.

Where is the confluence page?
> https://airtime.atlassian.net/wiki/spaces/ENG/pages/2785542166/Recording+and+Asynchronous+Tag+State+Notifications

How do I run the tests?
> From within the svc container, after doing a docker-up.sh, run: npm test
