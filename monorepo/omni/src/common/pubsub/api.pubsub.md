# API Documentation

## Table of Contents

- [PubSub](#pubsub)
- [Message](#message)
- [LengthDelimitedString](#lengthdelimitedstring)
- [PropertyPath](#propertypath)
- [PathArray](#patharray)

## PubSub

The `PubSub` class is responsible for publishing and subscribing messages to various partitions with a Kafka broker, and maintaining message persistence via a Redis store.

### Properties

- `producer: Producer | undefined`
- `consumer: Consumer | undefined`
- `kafka: Kafka`
- `redis: Redis`
- `disposables: AsyncDisposableStack`
- `isWorkerRunning: boolean`

### Methods

- `lazilyConnectProducer(): Promise<Producer>`: Connects to a Kafka broker and initializes the class `producer` property if not connected.
- `publish(seqnoPath: SeqnoPath, tagPath: TagPath, message: Message, ttl?: number): Promise<void>`: Publishes a message to a Kafka broker under the specified `seqnoPath` and `tagPath`.
- `subscribe(seqnoPath: SeqnoPath): AsyncQueue<Message>`: Subscribes to messages under the specified `seqnoPath` and returns an `AsyncQueue` containing the messages fetched.
- `runWorker(): Promise<void>`: Runs the background worker for processing partition messages with a Kafka broker and updating Redis storage accordingly.

## Message

The `Message` class is responsible for parsing and serializing messages that are used by the PubSub class for message publishing and consuming.

### Properties

- `data: Map<string, string>`

### Methods

- `deserialize(serializedData: string, startingOffset?: number): { message: Message; offset: number }`: Deserializes the input string into a `Message` object, along with the offset of the deserialization.
- `set(tag: string, value: string): void`: Sets a tag and value pair in the internal message data.
- `get(tag: string): string | undefined`: Retrieves the value associated with the given tag in the message data.
- `serialize(): string`: Serializes the message data into a string.

## LengthDelimitedString

The `LengthDelimitedString` class is responsible for working with strings that require a length delimiter for serialization and deserialization.

### Methods

- `serialize(string: string): string`: Serializes the input string with a length delimiter added.
- `deserialize(serialized: string): { str: string | null; offset: number }`: Deserializes the input serialized string, returning string the without the length delimiter and the offset.

## PropertyPath

The `PropertyPath` class represents a collection of tag-value pairs and provides methods for serialization and deserialization.

### Properties

- `data: Property[]`

### Methods

- `deserialize(serializedData: string, startingOffset?: number): { propertyPath: PropertyPath; offset: number }`: Deserializes the input string into a `PropertyPath` object, along with the offset of the deserialization.
- `set(tag: string, value: string): void`: Sets a tag and value pair in the internal property data.
- `get(tag: string): string | undefined`: Retrieves the value associated with the given tag in the property data.
- `serialize(): string`: Serializes the property data into a string.

## PathArray

The `PathArray` class extends `Array<string>` and provides methods for serialization and deserialization of arrays of strings.

### Methods

- `serialize(pathArray: PathArray): string`: Serializes the `PathArray` object into a string.
- `deserialize(serializedData: string, startingOffset?: number): { pathArray: PathArray; offset: number }`: Deserializes the input string into a `PathArray` object, along with the offset of the deserialization.
- `serialize(): string`: Serializes the `PathArray` object into a string.
