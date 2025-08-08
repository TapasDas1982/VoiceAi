#!/usr/bin/env node

/**
 * MCP Memory Server - Helps remember everything and keep track of project state
 * This server provides memory and tracking capabilities for the VoiceAI project
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fs = require('fs').promises;
const path = require('path');

class MemoryServer {
  constructor() {
    this.server = new Server(
      {
        name: 'voiceai-memory-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.memoryFile = path.join(__dirname, 'project-memory.json');
    this.setupHandlers();
  }

  async loadMemory() {
    try {
      const data = await fs.readFile(this.memoryFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // Return default memory structure if file doesn't exist
      return {
        projectStatus: {
          currentPhase: 'Phase 1 - Simplification Complete',
          lastUpdate: new Date().toISOString(),
          workingComponents: [
            'main.js - Entry point and orchestration',
            'sip-client.js - SIP protocol handling', 
            'ai-processor.js - OpenAI integration',
            'audio-handler.js - RTP/Audio processing',
            'config.js - Configuration management'
          ],
          issues: [
            'SIP registration timeout (expected without SIP server)'
          ],
          nextSteps: [
            'Test with actual SIP server',
            'Verify call handling',
            'Test AI integration'
          ]
        },
        conversationContext: {
          lastSession: new Date().toISOString(),
          keyDecisions: [
            'Adopted simplified modular architecture',
            'Removed unnecessary abstractions',
            'Implemented single-purpose components'
          ],
          userPreferences: {
            simplicity: true,
            modularArchitecture: true,
            singleResponsibility: true,
            continuousCommunication: true
          }
        },
        technicalState: {
          architecture: 'simplified-modular',
          mainFiles: [
            'main.js',
            'sip-client.js', 
            'ai-processor.js',
            'audio-handler.js',
            'config.js'
          ],
          runningServices: [
            'HTTP Dashboard on port 3000',
            'SIP Client on port 5061',
            'RTP Handler on port 5004'
          ],
          lastSuccessfulTest: new Date().toISOString()
        },
        achievements: [
          {
            achievement: 'Successfully simplified VoiceAI architecture',
            impact: 'Reduced complexity from 2200+ lines to 5 focused modules',
            timestamp: new Date().toISOString()
          }
        ],
        issues: [],
        progress: []
      };
    }
  }

  async saveMemory(memory) {
    await fs.writeFile(this.memoryFile, JSON.stringify(memory, null, 2));
  }

  setupHandlers() {
    // Handle tool calls
    this.server.setRequestHandler({ method: 'tools/call' }, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'remember_status':
          return await this.rememberStatus(args);
        
        case 'get_memory':
          return await this.getMemory(args);
        
        case 'update_progress':
          return await this.updateProgress(args);
        
        case 'track_issue':
          return await this.trackIssue(args);
        
        case 'record_achievement':
          return await this.recordAchievement(args);
        
        case 'set_context':
          return await this.setContext(args);
        
        case 'get_next_steps':
          return await this.getNextSteps();
        
        case 'get_summary':
          return await this.getSummary();
        
        case 'clear_memory':
          return await this.clearMemory(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // List available tools
    this.server.setRequestHandler({ method: 'tools/list' }, async () => {
      return {
        tools: [
          {
            name: 'remember_status',
            description: 'Store current project status and component states',
            inputSchema: {
              type: 'object',
              properties: {
                phase: { type: 'string', description: 'Current project phase' },
                workingComponents: { type: 'array', items: { type: 'string' }, description: 'List of working components' },
                issues: { type: 'array', items: { type: 'string' }, description: 'Current issues or problems' },
                nextSteps: { type: 'array', items: { type: 'string' }, description: 'Planned next steps' }
              },
              required: ['phase']
            }
          },
          {
            name: 'get_memory',
            description: 'Retrieve stored project memory and context',
            inputSchema: {
              type: 'object',
              properties: {
                section: { type: 'string', description: 'Specific memory section to retrieve (optional)' }
              }
            }
          },
          {
            name: 'get_summary',
            description: 'Get a concise summary of current project state',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'update_progress',
            description: 'Update project progress and milestones',
            inputSchema: {
              type: 'object',
              properties: {
                milestone: { type: 'string', description: 'Milestone achieved' },
                details: { type: 'string', description: 'Progress details' }
              },
              required: ['milestone']
            }
          },
          {
            name: 'track_issue',
            description: 'Track and store issues or problems encountered',
            inputSchema: {
              type: 'object',
              properties: {
                issue: { type: 'string', description: 'Description of the issue' },
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Issue severity' },
                status: { type: 'string', enum: ['open', 'investigating', 'resolved'], description: 'Issue status' },
                solution: { type: 'string', description: 'Solution if resolved' }
              },
              required: ['issue', 'severity']
            }
          },
          {
            name: 'record_achievement',
            description: 'Record significant achievements and successes',
            inputSchema: {
              type: 'object',
              properties: {
                achievement: { type: 'string', description: 'What was achieved' },
                impact: { type: 'string', description: 'Impact or benefit of this achievement' }
              },
              required: ['achievement']
            }
          },
          {
            name: 'set_context',
            description: 'Set conversation context and user preferences',
            inputSchema: {
              type: 'object',
              properties: {
                userPreferences: { type: 'object', description: 'User preferences and settings' },
                keyDecisions: { type: 'array', items: { type: 'string' }, description: 'Important decisions made' },
                context: { type: 'string', description: 'Current conversation context' }
              }
            }
          },
          {
            name: 'get_next_steps',
            description: 'Get recommended next steps based on current state',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'clear_memory',
            description: 'Clear all stored memory (use with caution)',
            inputSchema: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean', description: 'Confirmation to clear memory' }
              },
              required: ['confirm']
            }
          }
        ]
      };
    });
  }

  async rememberStatus(args) {
    const memory = await this.loadMemory();
    
    memory.projectStatus = {
      currentPhase: args.phase,
      lastUpdate: new Date().toISOString(),
      workingComponents: args.workingComponents || [],
      issues: args.issues || [],
      nextSteps: args.nextSteps || []
    };

    await this.saveMemory(memory);
    
    return {
      content: [{
        type: 'text',
        text: `✅ Project status remembered: ${args.phase}\n📦 Working components: ${args.workingComponents?.length || 0}\n⚠️ Issues: ${args.issues?.length || 0}\n🎯 Next steps: ${args.nextSteps?.length || 0}`
      }]
    };
  }

  async getMemory(args) {
    const memory = await this.loadMemory();
    
    if (args.section) {
      const section = memory[args.section];
      return {
        content: [{
          type: 'text',
          text: section ? JSON.stringify(section, null, 2) : `Section '${args.section}' not found`
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(memory, null, 2)
      }]
    };
  }

  async getSummary() {
    const memory = await this.loadMemory();
    
    const summary = `🎯 **VoiceAI Project Summary**\n\n` +
      `**Current Phase:** ${memory.projectStatus.currentPhase}\n` +
      `**Last Update:** ${new Date(memory.projectStatus.lastUpdate).toLocaleString()}\n\n` +
      `**✅ Working Components (${memory.projectStatus.workingComponents.length}):**\n` +
      memory.projectStatus.workingComponents.map(c => `  • ${c}`).join('\n') + '\n\n' +
      `**⚠️ Current Issues (${memory.projectStatus.issues.length}):**\n` +
      (memory.projectStatus.issues.length > 0 ? 
        memory.projectStatus.issues.map(i => `  • ${i}`).join('\n') : '  • None') + '\n\n' +
      `**🎯 Next Steps (${memory.projectStatus.nextSteps.length}):**\n` +
      (memory.projectStatus.nextSteps.length > 0 ? 
        memory.projectStatus.nextSteps.map(s => `  • ${s}`).join('\n') : '  • None') + '\n\n' +
      `**🏆 Recent Achievements (${memory.achievements.length}):**\n` +
      memory.achievements.slice(-3).map(a => `  • ${a.achievement}`).join('\n');

    return {
      content: [{
        type: 'text',
        text: summary
      }]
    };
  }

  async updateProgress(args) {
    const memory = await this.loadMemory();
    
    if (!memory.progress) memory.progress = [];
    
    memory.progress.push({
      milestone: args.milestone,
      details: args.details || '',
      timestamp: new Date().toISOString()
    });

    memory.projectStatus.lastUpdate = new Date().toISOString();
    await this.saveMemory(memory);
    
    return {
      content: [{
        type: 'text',
        text: `📈 Progress updated: ${args.milestone}`
      }]
    };
  }

  async trackIssue(args) {
    const memory = await this.loadMemory();
    
    if (!memory.issues) memory.issues = [];
    
    const issue = {
      id: Date.now().toString(),
      issue: args.issue,
      severity: args.severity,
      status: args.status || 'open',
      solution: args.solution || null,
      timestamp: new Date().toISOString()
    };

    memory.issues.push(issue);
    await this.saveMemory(memory);
    
    return {
      content: [{
        type: 'text',
        text: `🐛 Issue tracked: ${args.issue} (${args.severity} severity)`
      }]
    };
  }

  async recordAchievement(args) {
    const memory = await this.loadMemory();
    
    memory.achievements.push({
      achievement: args.achievement,
      impact: args.impact || '',
      timestamp: new Date().toISOString()
    });

    await this.saveMemory(memory);
    
    return {
      content: [{
        type: 'text',
        text: `🏆 Achievement recorded: ${args.achievement}`
      }]
    };
  }

  async setContext(args) {
    const memory = await this.loadMemory();
    
    if (args.userPreferences) {
      memory.conversationContext.userPreferences = {
        ...memory.conversationContext.userPreferences,
        ...args.userPreferences
      };
    }

    if (args.keyDecisions) {
      memory.conversationContext.keyDecisions = [
        ...memory.conversationContext.keyDecisions,
        ...args.keyDecisions
      ];
    }

    if (args.context) {
      memory.conversationContext.currentContext = args.context;
    }

    memory.conversationContext.lastSession = new Date().toISOString();
    await this.saveMemory(memory);
    
    return {
      content: [{
        type: 'text',
        text: '🧠 Conversation context updated'
      }]
    };
  }

  async getNextSteps() {
    const memory = await this.loadMemory();
    
    const nextSteps = memory.projectStatus.nextSteps || [];
    const openIssues = (memory.issues || []).filter(issue => issue.status === 'open');
    
    let recommendations = [...nextSteps];
    
    if (openIssues.length > 0) {
      recommendations.push(`Address ${openIssues.length} open issues`);
    }

    const stepsText = recommendations.length > 0 ? 
      recommendations.map((step, i) => `${i + 1}. ${step}`).join('\n') :
      'No specific next steps defined';

    return {
      content: [{
        type: 'text',
        text: `🎯 **Next Steps:**\n${stepsText}\n\n⚠️ **Open Issues:** ${openIssues.length}`
      }]
    };
  }

  async clearMemory(args) {
    if (!args.confirm) {
      return {
        content: [{
          type: 'text',
          text: '❌ Memory clear cancelled - confirmation required'
        }]
      };
    }

    await fs.unlink(this.memoryFile).catch(() => {}); // Ignore if file doesn't exist
    
    return {
      content: [{
        type: 'text',
        text: '🗑️ Memory cleared successfully'
      }]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🧠 VoiceAI Memory Server running on stdio');
  }
}

// Run the server
const server = new MemoryServer();
server.run().catch(console.error);