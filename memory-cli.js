#!/usr/bin/env node
/**
 * Memory Manager CLI
 * Simple command-line interface for the VoiceAI memory system
 */

const MemoryManager = require('./memory-manager');
const readline = require('readline');

class MemoryCLI {
  constructor() {
    this.memory = new MemoryManager();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🧠 memory> '
    });
    
    this.commands = {
      'help': this.showHelp.bind(this),
      'h': this.showHelp.bind(this),
      'status': this.showStatus.bind(this),
      's': this.showStatus.bind(this),
      'summary': this.showSummary.bind(this),
      'detailed': this.showDetailedSummary.bind(this),
      'remember': this.rememberStatus.bind(this),
      'achieve': this.recordAchievement.bind(this),
      'issue': this.trackIssue.bind(this),
      'progress': this.updateProgress.bind(this),
      'context': this.setContext.bind(this),
      'next': this.getNextSteps.bind(this),
      'backup': this.backup.bind(this),
      'restore': this.restore.bind(this),
      'clear': this.clearMemory.bind(this),
      'issues': this.showIssues.bind(this),
      'resolve': this.resolveIssue.bind(this),
      'exit': this.exit.bind(this),
      'quit': this.exit.bind(this),
      'q': this.exit.bind(this)
    };
  }

  async start() {
    console.log('🧠 VoiceAI Memory Manager CLI');
    console.log('Type "help" for available commands\n');
    
    // Show initial status
    await this.showStatus();
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      const [command, ...args] = input.trim().split(' ');
      
      if (command === '') {
        this.rl.prompt();
        return;
      }
      
      if (this.commands[command]) {
        try {
          await this.commands[command](args);
        } catch (error) {
          console.log(`❌ Error: ${error.message}`);
        }
      } else {
        console.log(`❓ Unknown command: ${command}. Type "help" for available commands.`);
      }
      
      this.rl.prompt();
    });
    
    this.rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      process.exit(0);
    });
  }

  showHelp() {
    console.log(`
📚 Available Commands:

` +
      `📊 Status & Information:
` +
      `  status, s           - Show quick status
` +
      `  summary             - Show summary
` +
      `  detailed            - Show detailed summary
` +
      `  issues              - Show all issues
` +
      `  next                - Show next steps

` +
      `✏️  Memory Operations:
` +
      `  remember <phase>    - Update project status
` +
      `  achieve <text>      - Record achievement
` +
      `  issue <text>        - Track new issue
` +
      `  progress <text>     - Update progress
` +
      `  context <text>      - Set context
` +
      `  resolve <id>        - Resolve issue by ID

` +
      `💾 File Operations:
` +
      `  backup [name]       - Create backup
` +
      `  restore <file>      - Restore from backup
` +
      `  clear               - Clear all memory

` +
      `🚪 System:
` +
      `  help, h             - Show this help
` +
      `  exit, quit, q       - Exit CLI
`);
  }

  async showStatus() {
    const status = await this.memory.quickStatus();
    console.log(`\n📊 Quick Status:`);
    console.log(`   Phase: ${status.phase}`);
    console.log(`   Components: ${status.components}`);
    console.log(`   Issues: ${status.issues}`);
    console.log(`   Next Steps: ${status.nextSteps}`);
  }

  async showSummary() {
    const summary = await this.memory.getSummary();
    console.log('\n📋 Memory Summary:');
    console.log(JSON.stringify(summary, null, 2));
  }

  async showDetailedSummary() {
    const summary = await this.memory.getDetailedSummary();
    console.log('\n' + summary);
  }

  async rememberStatus(args) {
    if (args.length === 0) {
      console.log('❓ Usage: remember <phase description>');
      return;
    }
    
    const phase = args.join(' ');
    const result = await this.memory.rememberStatus(phase, [], [], []);
    console.log(result.message);
  }

  async recordAchievement(args) {
    if (args.length === 0) {
      console.log('❓ Usage: achieve <achievement description>');
      return;
    }
    
    const achievement = args.join(' ');
    const result = await this.memory.recordAchievement(achievement);
    console.log(result.message);
  }

  async trackIssue(args) {
    if (args.length === 0) {
      console.log('❓ Usage: issue <issue description>');
      return;
    }
    
    const issue = args.join(' ');
    const result = await this.memory.trackIssue(issue);
    console.log(result.message);
  }

  async updateProgress(args) {
    if (args.length === 0) {
      console.log('❓ Usage: progress <progress description>');
      return;
    }
    
    const progress = args.join(' ');
    const result = await this.memory.updateProgress(progress);
    console.log(result.message);
  }

  async setContext(args) {
    if (args.length === 0) {
      console.log('❓ Usage: context <context description>');
      return;
    }
    
    const context = args.join(' ');
    const result = await this.memory.setContext({}, [], context);
    console.log(result.message);
  }

  async getNextSteps() {
    const nextSteps = await this.memory.getNextSteps();
    console.log('\n🎯 Next Steps:');
    console.log(nextSteps.formatted || 'No next steps defined');
  }

  async backup(args) {
    const backupName = args[0] || null;
    const result = await this.memory.backup(backupName);
    console.log(result.message);
  }

  async restore(args) {
    if (args.length === 0) {
      console.log('❓ Usage: restore <backup-filename>');
      return;
    }
    
    const result = await this.memory.restore(args[0]);
    console.log(result.message);
  }

  async clearMemory() {
    console.log('⚠️  Are you sure you want to clear all memory? This cannot be undone.');
    console.log('Type "yes" to confirm or anything else to cancel:');
    
    return new Promise((resolve) => {
      this.rl.question('', async (answer) => {
        if (answer.toLowerCase() === 'yes') {
          const result = await this.memory.clearMemory();
          console.log(result.message);
        } else {
          console.log('❌ Memory clear cancelled');
        }
        resolve();
      });
    });
  }

  async showIssues() {
    const allIssues = await this.memory.getIssues('all');
    const openIssues = allIssues.filter(i => i.status === 'open');
    const resolvedIssues = allIssues.filter(i => i.status === 'resolved');
    
    console.log(`\n🐛 Issues Summary:`);
    console.log(`   Total: ${allIssues.length}`);
    console.log(`   Open: ${openIssues.length}`);
    console.log(`   Resolved: ${resolvedIssues.length}`);
    
    if (openIssues.length > 0) {
      console.log('\n⚠️  Open Issues:');
      openIssues.forEach(issue => {
        console.log(`   [${issue.id}] ${issue.issue} (${issue.severity})`);
      });
    }
    
    if (resolvedIssues.length > 0) {
      console.log('\n✅ Recently Resolved:');
      resolvedIssues.slice(-3).forEach(issue => {
        console.log(`   [${issue.id}] ${issue.issue}`);
      });
    }
  }

  async resolveIssue(args) {
    if (args.length === 0) {
      console.log('❓ Usage: resolve <issue-id>');
      console.log('Use "issues" command to see issue IDs');
      return;
    }
    
    const issueId = args[0];
    const solution = args.slice(1).join(' ') || 'Resolved via CLI';
    
    const result = await this.memory.resolveIssue(issueId, solution);
    console.log(result.message);
  }

  exit() {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  }
}

// Start CLI if run directly
if (require.main === module) {
  const cli = new MemoryCLI();
  cli.start().catch(console.error);
}

module.exports = MemoryCLI;