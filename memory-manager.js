/**
 * Simple Memory Manager for VoiceAI Project
 * Tracks project state, progress, and context without complex dependencies
 */

const fs = require('fs').promises;
const path = require('path');

class MemoryManager {
  constructor(memoryFile = 'project-memory.json') {
    this.memoryFile = path.join(__dirname, memoryFile);
    this.initializeMemory();
  }

  async initializeMemory() {
    try {
      await this.loadMemory();
    } catch (error) {
      // Create default memory if file doesn't exist
      await this.saveMemory(this.getDefaultMemory());
      console.log('🧠 Memory Manager initialized with default state');
    }
  }

  getDefaultMemory() {
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
        },
        currentContext: 'VoiceAI simplification project - maintaining clean architecture'
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
      progress: [],
      metadata: {
        version: '1.0.0',
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
      }
    };
  }

  async loadMemory() {
    try {
      const data = await fs.readFile(this.memoryFile, 'utf8');
      const memory = JSON.parse(data);
      memory.metadata.lastAccessed = new Date().toISOString();
      return memory;
    } catch (error) {
      throw new Error(`Failed to load memory: ${error.message}`);
    }
  }

  async saveMemory(memory) {
    try {
      memory.metadata.lastAccessed = new Date().toISOString();
      await fs.writeFile(this.memoryFile, JSON.stringify(memory, null, 2));
    } catch (error) {
      throw new Error(`Failed to save memory: ${error.message}`);
    }
  }

  // Core memory operations
  async rememberStatus(phase, workingComponents = [], issues = [], nextSteps = []) {
    const memory = await this.loadMemory();
    
    memory.projectStatus = {
      currentPhase: phase,
      lastUpdate: new Date().toISOString(),
      workingComponents,
      issues,
      nextSteps
    };

    await this.saveMemory(memory);
    
    return {
      success: true,
      message: `✅ Project status remembered: ${phase}`,
      details: {
        components: workingComponents.length,
        issues: issues.length,
        nextSteps: nextSteps.length
      }
    };
  }

  async getMemory(section = null) {
    const memory = await this.loadMemory();
    
    if (section) {
      return memory[section] || null;
    }
    
    return memory;
  }

  async getSummary() {
    const memory = await this.loadMemory();
    
    return {
      phase: memory.projectStatus.currentPhase,
      lastUpdate: memory.projectStatus.lastUpdate,
      workingComponents: memory.projectStatus.workingComponents.length,
      issues: memory.projectStatus.issues.length,
      nextSteps: memory.projectStatus.nextSteps.length,
      achievements: memory.achievements.length,
      architecture: memory.technicalState.architecture,
      runningServices: memory.technicalState.runningServices.length
    };
  }

  async getDetailedSummary() {
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

    return summary;
  }

  async updateProgress(milestone, details = '') {
    const memory = await this.loadMemory();
    
    if (!memory.progress) memory.progress = [];
    
    memory.progress.push({
      milestone,
      details,
      timestamp: new Date().toISOString()
    });

    memory.projectStatus.lastUpdate = new Date().toISOString();
    await this.saveMemory(memory);
    
    return {
      success: true,
      message: `📈 Progress updated: ${milestone}`
    };
  }

  async trackIssue(issue, severity = 'medium', status = 'open', solution = null) {
    const memory = await this.loadMemory();
    
    if (!memory.issues) memory.issues = [];
    
    const issueObj = {
      id: Date.now().toString(),
      issue,
      severity,
      status,
      solution,
      timestamp: new Date().toISOString()
    };

    memory.issues.push(issueObj);
    await this.saveMemory(memory);
    
    return {
      success: true,
      message: `🐛 Issue tracked: ${issue} (${severity} severity)`,
      issueId: issueObj.id
    };
  }

  async recordAchievement(achievement, impact = '') {
    const memory = await this.loadMemory();
    
    memory.achievements.push({
      achievement,
      impact,
      timestamp: new Date().toISOString()
    });

    await this.saveMemory(memory);
    
    return {
      success: true,
      message: `🏆 Achievement recorded: ${achievement}`
    };
  }

  async setContext(userPreferences = {}, keyDecisions = [], context = '') {
    const memory = await this.loadMemory();
    
    if (Object.keys(userPreferences).length > 0) {
      memory.conversationContext.userPreferences = {
        ...memory.conversationContext.userPreferences,
        ...userPreferences
      };
    }

    if (keyDecisions.length > 0) {
      memory.conversationContext.keyDecisions = [
        ...memory.conversationContext.keyDecisions,
        ...keyDecisions
      ];
    }

    if (context) {
      memory.conversationContext.currentContext = context;
    }

    memory.conversationContext.lastSession = new Date().toISOString();
    await this.saveMemory(memory);
    
    return {
      success: true,
      message: '🧠 Conversation context updated'
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

    return {
      nextSteps: recommendations,
      openIssues: openIssues.length,
      formatted: recommendations.length > 0 ? 
        recommendations.map((step, i) => `${i + 1}. ${step}`).join('\n') :
        'No specific next steps defined'
    };
  }

  async clearMemory() {
    await fs.unlink(this.memoryFile).catch(() => {}); // Ignore if file doesn't exist
    await this.initializeMemory();
    
    return {
      success: true,
      message: '🗑️ Memory cleared and reinitialized'
    };
  }

  // Utility methods
  async backup(backupName = null) {
    const memory = await this.loadMemory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = backupName || `project-memory-backup-${timestamp}.json`;
    const backupPath = path.join(__dirname, backupFile);
    
    await fs.writeFile(backupPath, JSON.stringify(memory, null, 2));
    
    return {
      success: true,
      message: `💾 Memory backed up to ${backupFile}`,
      backupPath
    };
  }

  async restore(backupFile) {
    try {
      const backupPath = path.join(__dirname, backupFile);
      const data = await fs.readFile(backupPath, 'utf8');
      const memory = JSON.parse(data);
      
      await this.saveMemory(memory);
      
      return {
        success: true,
        message: `🔄 Memory restored from ${backupFile}`
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to restore from ${backupFile}: ${error.message}`
      };
    }
  }

  // Quick access methods
  async quickStatus() {
    const memory = await this.loadMemory();
    return {
      phase: memory.projectStatus.currentPhase,
      components: memory.projectStatus.workingComponents.length,
      issues: memory.projectStatus.issues.length,
      nextSteps: memory.projectStatus.nextSteps.length
    };
  }

  async getIssues(status = 'all') {
    const memory = await this.loadMemory();
    const issues = memory.issues || [];
    
    if (status === 'all') {
      return issues;
    }
    
    return issues.filter(issue => issue.status === status);
  }

  async resolveIssue(issueId, solution) {
    const memory = await this.loadMemory();
    const issue = memory.issues.find(i => i.id === issueId);
    
    if (!issue) {
      return {
        success: false,
        message: `❌ Issue with ID ${issueId} not found`
      };
    }
    
    issue.status = 'resolved';
    issue.solution = solution;
    issue.resolvedAt = new Date().toISOString();
    
    await this.saveMemory(memory);
    
    return {
      success: true,
      message: `✅ Issue resolved: ${issue.issue}`
    };
  }
}

module.exports = MemoryManager;