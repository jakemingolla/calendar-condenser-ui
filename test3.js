import crypto from 'crypto';

const generateUUID = () => {
  return crypto.randomUUID();
}

console.log("beginning request at", new Date().toISOString());
const response = await fetch(`http://localhost:8000/api/v1/graphs/default/threads/${generateUUID()}/stream`, {
  method: 'POST',
});
console.log("response received at", new Date().toISOString());

if (!response.body) {
  throw new Error("No response body");
}

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split("\n").filter((line) => line.trim());
  
  console.log("chunk received", new Date().toISOString(), `(${lines.length} lines): ${lines[0].slice(0, 30)}`);
}
