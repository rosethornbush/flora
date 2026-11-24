export const token = process.env.DISCORD_TOKEN;
export const ownerId = process.env.DISCORD_OWNER_ID;

if (!token) throw new Error("DISCORD_TOKEN is required.");
if (!ownerId || !/^\d{17,20}$/.test(ownerId)) {
  throw new Error("DISCORD_OWNER_ID must be your Discord user ID.");
}
