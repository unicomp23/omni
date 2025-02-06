import { Redis } from "ioredis";
import { Message } from "../message/message";
import { TagDataSnapshotIdentifier, TagDataObjectIdentifier } from "./redShared";

export class RedPub {
    private redisClient: Redis;
    private publishScriptSha: string | null = null;

    constructor(redisClient: Redis) {
        this.redisClient = redisClient;
        this.initPublishScript();
    }

    async initPublishScript() {
        const script = `
      local seqno_key = KEYS[1]
      local snap_key = KEYS[2]
      local stream_key = KEYS[3]
      local timer_key = KEYS[4]
      local gc_key = KEYS[5]

      local tag_path = ARGV[1]
      local serialized_message = ARGV[2]
      local timeout_snap_seconds = tonumber(ARGV[3])
      local timeout_tag_seconds = tonumber(ARGV[4])

      local seqno = redis.call('INCR', seqno_key)
      redis.call('HSET', snap_key, tag_path, serialized_message)
      local xadd_id = redis.call('XADD', stream_key, '*', 'tagPath', tag_path, 'message', serialized_message)
      redis.call('HSET', gc_key, tag_path, xadd_id)

      if timeout_snap_seconds and timeout_snap_seconds > 0 then
        redis.call('EXPIRE', snap_key, timeout_snap_seconds)
        redis.call('EXPIRE', stream_key, timeout_snap_seconds)
      end

      if timeout_tag_seconds and timeout_tag_seconds > 0 then
        local message = {}
        message['command'] = 'expire'
        message['xaddId'] = xadd_id
        local future_time = tonumber(xadd_id:split('-')[1]) + (timeout_tag_seconds * 1000)
        local id = future_time .. '-0'
        redis.call('XADD', timer_key, id, 'tagPath', tag_path, 'message', message)
      end

      return xadd_id
    `;
        this.publishScriptSha = await this.redisClient.script("LOAD", script) as string;
    }

    async publish(
        seqnoPath: TagDataSnapshotIdentifier,
        tagPath: TagDataObjectIdentifier,
        message: Message,
        options: {
            timeoutSnapSeconds: number;
            timeoutTagSeconds: number;
        } | null
    ): Promise<{ xaddId: string }> {
        if (!tagPath.startsWith(seqnoPath)) {
            throw new Error("TagPath must start with SeqnoPath");
        }

        const seqnoKey = "seqno:" + seqnoPath.serialize();
        const snapKey = "snap:" + seqnoPath.serialize();
        const streamKey = "stream:" + seqnoPath.serialize();
        const timerKey = "timer:" + seqnoPath.serialize();
        const gcKey = "gc:" + seqnoPath.serialize();

        message.set("command", "publish");
        message.set("seqno", (await this.redisClient.incr(seqnoKey)).toString());
        const serializedMessage = message.serialize();

        let xaddId: string;
        try {
            xaddId = await this.redisClient.evalsha(
                this.publishScriptSha!,
                5,
                seqnoKey,
                snapKey,
                streamKey,
                timerKey,
                gcKey,
                tagPath.serialize(),
                serializedMessage,
                options?.timeoutSnapSeconds?.toString() ?? "0",
                options?.timeoutTagSeconds?.toString() ?? "0"
            ) as string;
        } catch (error) {
            console.error('Lua error:', error);
            throw error;
        }

        return {
            xaddId,
        };
    }
}