import * as dotenv from 'dotenv';
import * as readline from 'readline';
import { startConversation, chat } from './services/conversationService';

dotenv.config();

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? 'demo-user';

async function main() {
  console.log('AI Notatnik — interactive chat');
  console.log('Type your message and press Enter. Type "exit" to quit.\n');

  const conversation = await startConversation(DEFAULT_USER_ID);
  console.log(`Conversation started (id: ${conversation.id})\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question('You: ', async (input: string) => {
      const message = input.trim();
      if (!message || message.toLowerCase() === 'exit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }

      try {
        const response = await chat(conversation.id, DEFAULT_USER_ID, message);
        console.log(`\nAI: ${response}\n`);
      } catch (err) {
        console.error('Error:', err);
      }

      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
