import { s3Fetch } from "../src/s3.ts";

const endpoint = (process.env.S3_ENDPOINT || "https://s3.regru.cloud").replace(/\/$/, "");
const bucket = process.env.S3_BUCKET || "stng";
const regions = [process.env.S3_REGION || "ru-1", "us-east-1", "ru-central-1"].filter(
  (region, index, all) => all.indexOf(region) === index,
);

let listed = false;
for (const region of regions) {
  const url = `${endpoint}/${bucket}?list-type=2&max-keys=5`;
  const response = await s3Fetch(url, { region });
  const body = await response.text();
  console.log(`region=${region} status=${response.status}`);
  if (response.status === 200) {
    const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1]);
    console.log(keys.length ? `keys:\n${keys.join("\n")}` : "bucket is empty");
    listed = true;
    break;
  }
  console.log(body.slice(0, 500));
}

if (!listed) process.exit(1);
