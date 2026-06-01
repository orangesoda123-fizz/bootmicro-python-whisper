import { useState } from "react";

// "use client";

type ShellCommandResponse = {
    prompt: string;
    model: string;
    response: string;
};

function App() {
    const [result, setResult] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");

    const runShellCommand = async () => {
        setLoading(true);
        setError("");
        setResult("");

        try {
            const prompt = "Show the list of files in the current directory.";

            const response = await fetch(
                `http://localhost:8000/shell-commands?prompt=${encodeURIComponent(prompt)}`
            );

            console.log(`view response.ok: ${response.ok}`);
            console.log(`view response.status: ${response.status}`);

            if (!response.ok) { // response.ok is true, response.ok is false 
                throw new Error(`Request failed with status ${response.status}`);
            }

            
            const data: ShellCommandResponse = await response.json();
            console.log(`view response: ${data.response}`);
            console.log(`view model: ${data.model}`);
            console.log(`view prompt: ${data.prompt}`);

            setResult(data.response);
        }

        catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Something went wrong.");
            }
        }
        finally { // runs whether try or catch are run 
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
            <h1>Shell Commands</h1>

            <button onClick={runShellCommand} disabled={loading}>
                {loading ? "Running...": "Run Python Shell Command"}
            </button>

            {error && (
                <p style={{ color: "red" }}>
                    Error: {error}
                </p>
            )}

            

            {result && (
                <div style={{ marginTop: "1rem" }}>
                    <h2>Result:</h2>
                    <pre
                        style={{
                            backgroundColor: "#f4f4f4",
                            padding: "1rem",
                            borderRadius: "8px",
                            whiteSpace: "pre-wrap",
                        }}
                    >
                        {result}
                    </pre>
                </div>
            )}
        </div>
        
    )
}

export default App; 