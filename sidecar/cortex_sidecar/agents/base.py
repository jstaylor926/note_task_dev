import asyncio
import logging
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger("cortex-sidecar")

class BackgroundAgent(ABC):
    def __init__(self, name: str, interval_seconds: int = 3600):
        self.name = name
        self.interval_seconds = interval_seconds
        self.enabled = True
        self._task: Optional[asyncio.Task] = None

    @abstractmethod
    async def run(self):
        """Main execution logic for the agent."""
        pass

    async def start(self):
        """Start the periodic execution loop."""
        if self._task is not None:
            return
        
        self._task = asyncio.create_task(self._loop())
        logger.info(f"Agent '{self.name}' started (interval: {self.interval_seconds}s)")

    async def stop(self):
        """Stop the periodic execution loop."""
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info(f"Agent '{self.name}' stopped")

    async def _loop(self):
        while True:
            try:
                if self.enabled:
                    logger.info(f"Agent '{self.name}' running...")
                    await self.run()
            except Exception as e:
                logger.error(f"Error in agent '{self.name}': {e}")
            
            await asyncio.sleep(self.interval_seconds)

class AgentManager:
    def __init__(self):
        self.agents: Dict[str, BackgroundAgent] = {}

    def register_agent(self, agent: BackgroundAgent):
        self.agents[agent.name] = agent

    async def start_all(self):
        for agent in self.agents.values():
            await agent.start()

    async def stop_all(self):
        for agent in self.agents.values():
            await agent.stop()

    def get_agent(self, name: str) -> Optional[BackgroundAgent]:
        return self.agents.get(name)
