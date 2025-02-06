import { connect, NatsConnection, StringCodec, JetStreamManager, JetStreamClient, ConsumerConfig, AckPolicy, DeliverPolicy } from "nats";

const sc = StringCodec();

async function runNatsCoreTest(nc: NatsConnection, iterations: number) {
  console.log("Running NATS Core latency test...");
  const subject = "ping";
  const sub = nc.subscribe(subject);
  
  // Set up responder
  (async () => {
    for await (const m of sub) {
      m.respond(sc.encode("pong"));
    }
  })().catch(console.error);

  const latencies: number[] = [];
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const requestStart = process.hrtime.bigint();
    const msg = await nc.request(subject, sc.encode("ping"), { timeout: 1000 });
    const requestEnd = process.hrtime.bigint();
    sc.decode(msg.data);
    latencies.push(Number(requestEnd - requestStart) / 1e6); // Convert to milliseconds
  }
  
  const end = Date.now();
  const duration = end - start;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);

  console.log(`NATS Core: ${iterations} roundtrips in ${duration}ms`);
  console.log(`Avg latency: ${avgLatency.toFixed(3)}ms`);
  console.log(`Min latency: ${minLatency.toFixed(3)}ms`);
  console.log(`Max latency: ${maxLatency.toFixed(3)}ms`);

  sub.unsubscribe();
}

async function runJetStreamTest(js: JetStreamClient, jsm: JetStreamManager, iterations: number) {
  console.log("Running JetStream latency test...");
  const streamName = "PING_STREAM";
  const subject = "js.ping";
  const consumerName = "ping-consumer";

  // Create or update the stream
  await jsm.streams.add({ name: streamName, subjects: [subject] });

  // Create a consumer
  const consumerConfig: Partial<ConsumerConfig> = {
    durable_name: consumerName,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
  };
  await jsm.consumers.add(streamName, consumerConfig);

  const consumer = await js.consumers.get(streamName, consumerName);

  const latencies: number[] = [];
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    const publishStart = process.hrtime.bigint();
    await js.publish(subject, sc.encode("ping"));
    const msg = await consumer.next();
    const publishEnd = process.hrtime.bigint();
    if (msg) {
      msg.ack();
      latencies.push(Number(publishEnd - publishStart) / 1e6); // Convert to milliseconds
    }
  }

  const end = Date.now();
  const duration = end - start;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);

  console.log(`JetStream: ${iterations} roundtrips in ${duration}ms`);
  console.log(`Avg latency: ${avgLatency.toFixed(3)}ms`);
  console.log(`Min latency: ${minLatency.toFixed(3)}ms`);
  console.log(`Max latency: ${maxLatency.toFixed(3)}ms`);

  // Clean up
  try {
    await jsm.consumers.delete(streamName, consumerName);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.warn("Failed to delete consumer:", err.message);
    } else {
      console.warn("Failed to delete consumer:", String(err));
    }
  }
  
  try {
    await jsm.streams.delete(streamName);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.warn("Failed to delete stream:", err.message);
    } else {
      console.warn("Failed to delete stream:", String(err));
    }
  }
}

async function main() {
  const nc = await connect({ servers: "nats://shasta-nats-1:4222" });
  const js = nc.jetstream();
  const jsm = await js.jetstreamManager();

  const iterations = 1000;

  try {
    await runNatsCoreTest(nc, iterations);
    await runJetStreamTest(js, jsm, iterations);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await nc.drain();
  }
}

main().catch(console.error);