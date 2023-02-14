import {AirCoreFrame, Coordinates} from "../../proto/generated/devinternal_pb";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new Coordinates({kafkaKey: {kafkaPartitionKey: {x: {case: "partitionInteger", value: 42}}}})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

if(coord_2.sendTo?.kafkaKey?.kafkaPartitionKey?.x.case == "partitionInteger")
    console.log(`out: ${coord_2.sendTo?.kafkaKey?.kafkaPartitionKey.x.value}`);
