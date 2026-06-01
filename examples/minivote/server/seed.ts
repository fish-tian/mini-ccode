import { getDb, createPoll } from "./db";

// Initialize DB
getDb();

const demos = [
  {
    title: "你更喜欢哪种编程语言？",
    options: ["TypeScript", "Rust", "Go", "Python", "Kotlin"],
  },
  {
    title: "周末去哪儿玩？",
    options: ["宅家看剧", "户外徒步", "逛商场", "朋友聚会"],
  },
  {
    title: "最好的前端框架是？",
    options: ["React", "Vue", "Svelte", "Solid", "Angular"],
  },
  {
    title: "你一般几点睡觉？",
    options: ["22:00 前", "22:00-23:00", "23:00-00:00", "00:00 以后"],
  },
];

for (const demo of demos) {
  const id = createPoll(demo);
  console.log(`Created poll: ${id} — "${demo.title}"`);
}

console.log(`\n✅ Seed data done! ${demos.length} polls created.\n`);
console.log("Start the app with:");
console.log("  bun run dev");
console.log("  Server: http://localhost:3000");
console.log("  Client: http://localhost:5173");
