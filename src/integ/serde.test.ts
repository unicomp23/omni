import {AirCoreFrame, Coordinates} from "../../proto/gen/devinternal_pb";

describe(`serde`, () => {
    test(`simple test`, async () => {
        const coord = new AirCoreFrame({
            sendTo: new Coordinates({kafkaKey: {kafkaPartitionKey: {x: {case: "partitionInteger", value: 42}}}})
        });

        const bytes = coord.toBinary();
        const coord_2 = AirCoreFrame.fromBinary(bytes);

        expect(coord_2.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case).toBe("partitionInteger");
    })
})
