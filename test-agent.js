// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
import {
  WorkerOptions,
  cli,
  defineAgent,
} from '@livekit/agents';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

export default defineAgent({
  entry: async (ctx) => {
    console.log('🚀 Test agent entry called');
    
    await ctx.connect();
    console.log('✅ Connected to LiveKit room successfully!');
    console.log(`📡 Room: ${ctx.room.name}`);
    
    const participant = await ctx.waitForParticipant();
    console.log(`👤 Participant joined: ${participant.identity}`);
    
    // Keep the agent running
    setInterval(() => {
      console.log('🔄 Agent is running...');
    }, 10000);
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));