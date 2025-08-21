import "./index.css";
import { useState } from "react";

export function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [llmContent, setLlmContent] = useState("");
  const [currentState, setCurrentState] = useState<Record<string, any> | null>(null);

  const handleStart = async () => {
    setIsStarted(true);
    
    try {
      const response = await fetch('http://localhost:8000', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'AIMessageChunk') {
              if (data.content) {
                setLlmContent(prev => prev + data.content);
              }
            } else {
              // All other types are state updates - replace the entire state with the new data
              setCurrentState(data);
            }
          } catch (e) {
            console.error('Failed to parse JSON:', line);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setIsStarted(false);
    }
  };

  return (
    <div className="mx-auto p-8 -mt-32 text-center relative z-10">
      <h1 className="text-5xl font-mono font-bold mb-4 leading-tight text-gray-800">
        calendar-condenser
      </h1>
      
      {!isStarted ? (
        <button 
          onClick={handleStart}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
        >
          start
        </button>
      ) : (
        <div className="mt-6 relative">
          {/* Current State positioned to the left of the centered LLM Response */}
          <div className="absolute right-full mr-6 w-[400px]">
            {currentState && (
              <div className="p-4 bg-gray-100 rounded-lg text-left">
                <h2 className="font-semibold mb-2">Current State:</h2>
                <pre className="text-xs overflow-y-auto whitespace-pre-wrap h-[500px]">
                  {JSON.stringify(currentState, null, 2)}
                </pre>
              </div>
            )}
          </div>
          
          {/* Centered LLM Response column */}
          <div className="mx-auto w-[600px]">
            {llmContent && (
              <div className="p-4 bg-white border rounded-lg text-left">
                <h2 className="font-semibold mb-2">LLM Response:</h2>
                <p className="whitespace-pre-wrap">{llmContent}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
