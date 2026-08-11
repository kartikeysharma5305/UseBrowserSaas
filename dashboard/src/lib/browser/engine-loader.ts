import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export class EngineLoader {
  private agentModule: Promise<Record<string, unknown>> | null = null;
  private browserModule: Promise<Record<string, unknown>> | null = null;
  private llmModelsModule: Promise<Record<string, unknown>> | null = null;

  resolveRepoDist(relativePath: string): string {
    let current = moduleDirectory;
    const maxDepth = 12;

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
      const candidate = path.join(current, 'dist', relativePath);
      const candidateExists = fs.existsSync(candidate);

      if (hasPackageJson && candidateExists) {
        return candidate;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    throw new Error(`Cannot find Browser-Use engine at dist/${relativePath}.`);
  }

  async loadAgentModule() {
    if (!this.agentModule) {
      const modulePath = this.resolveRepoDist('agent/index.js');
      const moduleUrl = pathToFileURL(modulePath).href;
      this.agentModule = new Function('url', 'return import(url)')(moduleUrl);
    }
    return this.agentModule;
  }

  async loadBrowserModule() {
    if (!this.browserModule) {
      const modulePath = this.resolveRepoDist('browser/index.js');
      const moduleUrl = pathToFileURL(modulePath).href;
      this.browserModule = new Function('url', 'return import(url)')(moduleUrl);
    }
    return this.browserModule;
  }

  async loadLlmModelsModule() {
    if (!this.llmModelsModule) {
      const modulePath = this.resolveRepoDist('llm/models.js');
      const moduleUrl = pathToFileURL(modulePath).href;
      this.llmModelsModule = new Function('url', 'return import(url)')(
        moduleUrl
      );
    }
    return this.llmModelsModule;
  }

  async loadEngineModules() {
    const [agentModule, browserModule, llmModelsModule] = await Promise.all([
      this.loadAgentModule(),
      this.loadBrowserModule(),
      this.loadLlmModelsModule(),
    ]);

    return {
      AgentClass: (agentModule as { Agent: unknown }).Agent,
      BrowserProfileClass: (browserModule as { BrowserProfile: unknown })
        .BrowserProfile,
      BrowserSessionClass: (browserModule as { BrowserSession: unknown })
        .BrowserSession,
      getLlmByName: (
        llmModelsModule as { getLlmByName: (name: string) => unknown }
      ).getLlmByName,
    };
  }
}
