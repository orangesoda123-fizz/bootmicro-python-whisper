import argparse
import asyncio
import os
from collections.abc import Sequence
from pathlib import Path

from agents import (
    Agent,
    ModelSettings,
    Runner,
    ShellCallOutcome,
    ShellCommandOutput,
    ShellCommandRequest,
    ShellResult,
    ShellTool,
    trace,
)
from agents.items import ToolApprovalItem
from agents.run_context import RunContextWrapper
from agents.tool import ShellOnApprovalFunctionResult

from dotenv import load_dotenv
load_dotenv()

from openai import AsyncOpenAI 
from agents import set_default_openai_client, set_tracing_disabled 

azure_client = AsyncOpenAI( 
    api_key = os.environ["AZURE_OPENAI_API_KEY"],
    base_url = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/",
)

set_default_openai_client(azure_client, use_for_tracing=False)

set_tracing_disabled(True)

SHELL_AUTO_APPROVE = os.environ.get("SHELL_AUTO_APPROVE") == "1"

from fastapi import FastAPI, Query

app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware 

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["http://localhost:5173"],
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)


class ShellExecutor:
    """Executes shell commands; approval is handled via ShellTool."""

    def __init__(self, cwd: Path | None = None):
        self.cwd = Path(cwd or Path.cwd()) # need to convert cwd or Path.cwd() to path again to make sure self.cwd is a real Path object. 
        # self.cwd is a new variable. 

    async def __call__(self, request: ShellCommandRequest) -> ShellResult:
        action = request.data.action

        outputs: list[ShellCommandOutput] = []
        for command in action.commands:
            proc = await asyncio.create_subprocess_shell(
                command,
                cwd=self.cwd,
                env=os.environ.copy(),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            timed_out = False
            try:
                timeout = (action.timeout_ms or 0) / 1000 or None # None / 1000 doesn't happen. 
                # Returns 0 from None or 0 cause None is falsy and there is nothing after 0.
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError: # command takes too long and causes a timeout 
                proc.kill()
                stdout_bytes, stderr_bytes = await proc.communicate()
                timed_out = True

            stdout = stdout_bytes.decode("utf-8", errors="ignore") # convert bytes to normal python string
            stderr = stderr_bytes.decode("utf-8", errors="ignore") # convert bytes to normal python string 
            outputs.append(
                ShellCommandOutput(
                    command=command,
                    stdout=stdout,
                    stderr=stderr,
                    outcome=ShellCallOutcome(
                        type="timeout" if timed_out else "exit",
                        exit_code=getattr(proc, "returncode", None), # "returncode" from proc: proc.returncode. 0 is success 1 is failure. Or None is returned. 
                    ),
                )
            )

            if timed_out: # if timed out, won't get to the rest of them 
                break

        return ShellResult(
            output=outputs,
            provider_data={"working_directory": str(self.cwd)},
        )


async def prompt_shell_approval(commands: Sequence[str]) -> bool: # Sequence[str] is more general than list[str]. Sequence[str] can be a tuple too.
    """Simple CLI prompt for shell approvals."""
    if SHELL_AUTO_APPROVE:
        return True
    return False 


async def run_shell_agent(prompt: str, model: str) -> None:
    """
    This replaces the old main() function.
    Instead of printing the result, it returns the final output. 
    """
    with trace("shell_example"):
        async def on_shell_approval(
            _context: RunContextWrapper, approval_item: ToolApprovalItem
        ) -> ShellOnApprovalFunctionResult:
            raw = approval_item.raw_item # describes what tool wants to do 
            commands: Sequence[str] = () # empty sequence of strings 
            if isinstance(raw, dict):
                action = raw.get("action", {}) # get value for the key "action", is there is none return empty dict {}
                if isinstance(action, dict):
                    commands = action.get("commands", [])
            else:
                action_obj = getattr(raw, "action", None)
                if action_obj and hasattr(action_obj, "commands"):
                    commands = action_obj.commands
            approved = await prompt_shell_approval(commands)
            return {"approve": approved, 
                    "reason": "user rejected" if not approved else "approved"}

        agent = Agent(
            name="Shell Assistant",
            model=model,
            instructions=(
                "You can run shell commands using the shell tool. "
                "Keep responses concise and include command output when helpful."
            ),
            tools=[
                ShellTool(
                    executor=ShellExecutor(),
                    needs_approval=True,
                    on_approval=on_shell_approval, # when approval is needed, which tool to call
                )
            ],
            model_settings=ModelSettings(tool_choice="required"), # model is required to call a tool
        )

        result = await Runner.run(agent, prompt)
        return result.final_output 


@app.get("/shell-commands")
async def shell_commands(
    prompt: str=Query(
        default="Show the list of files in the current directory."
    ),
    model: str=Query(default="gpt-5.4"),
):
    final_output = await run_shell_agent(prompt, model)

    return {
        "prompt": prompt, 
        "model": model, 
        "response": final_output,
    }