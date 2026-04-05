"""
Persistent browser-use worker.
Reads JSON tasks from stdin, executes them, writes JSON results to stdout.
Stays alive between tasks so Edge and the LLM client don't cold-start each time.
"""
import asyncio
import sys
import os
import json
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

from browser_use import Agent, BrowserProfile
from browser_use.llm import ChatOpenAI

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# Full profile: ...\User Data\Profile 2 — close Edge while automating to avoid profile locks.
EDGE_USER_DATA = r"C:\Users\amand\AppData\Local\Microsoft\Edge\User Data"
EDGE_PROFILE_DIRECTORY = "Profile 2"

profile = BrowserProfile(
    executable_path=EDGE_EXE,
    user_data_dir=EDGE_USER_DATA,
    profile_directory=EDGE_PROFILE_DIRECTORY,
    headless=False,
    keep_alive=True,  # Keep the browser open between tasks
)

llm = ChatOpenAI(model="gpt-4o-mini", api_key=os.environ.get("OPENAI_API_KEY"))

# Signal ready
print(json.dumps({"status": "ready"}), flush=True)

async def run_task(task: str) -> str:
    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        max_actions_per_step=3,
        max_failures=1,
        extend_system_message=(
            "Once you have navigated to the requested page and it has loaded, "
            "immediately mark the task as done. Do not take any further actions. "
            "If a tab is closed or unavailable, mark the task as done immediately."
        ),
    )
    result = await agent.run(max_steps=5)
    return result.final_result() or "(Task completed with no text output.)"

async def main():
    loop = asyncio.get_event_loop()

    while True:
        try:
            # Use thread executor to avoid Python 3.14 Windows pipe bug
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            msg = json.loads(line.strip())
            task = msg.get("task", "")
            if not task:
                print(json.dumps({"error": "no task provided"}), flush=True)
                continue
            try:
                output = await run_task(task)
                print(json.dumps({"output": output}), flush=True)
            except Exception as e:
                print(json.dumps({"error": str(e)}), flush=True)
        except Exception as e:
            print(json.dumps({"error": f"worker error: {e}"}), flush=True)

asyncio.run(main())
