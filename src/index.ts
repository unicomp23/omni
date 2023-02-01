import {AirCoreFrame, SendTo} from "../proto/generated/devinternal_pb";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new SendTo({kafkaTopic: "topic"})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

console.log(`out: ${coord_2.sendTo?.kafkaTopic}`);
