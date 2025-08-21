import "./index.css";
import { useState } from "react";

// Type definitions based on the OpenAPI schema
interface User {
  id: string;
  given_name: string;
  timezone: string;
  avatar_url: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  invitees: any[];
}

interface Calendar {
  id: string;
  name: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

interface StateWithCalendar {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
}

interface StateWithInvitees {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
}

interface StateWithPendingReschedulingProposals {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
  pending_rescheduling_proposals: any[];
}

interface StateWithCompletedReschedulingProposals {
  type: string;
  date: string;
  user: User;
  calendar: Calendar;
  invitees: User[];
  invitee_calendars: Record<string, Calendar>;
  pending_rescheduling_proposals: any[];
  completed_rescheduling_proposals: any[];
}

export function App() {
  const [isStarted, setIsStarted] = useState(false);
  const [llmContent, setLlmContent] = useState("");
  const [currentState, setCurrentState] = useState<Record<string, any> | null>(null);

  const handleStart = async () => {
    setIsStarted(true);
    
    try {
      const response = await fetch('http://localhost:8000/api/v1/graphs/default/stream', {
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
            } else if (data.type && data.type !== 'AIMessageChunk') {
              // All other types with a type field are state updates - replace the entire state with the new data
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

  // Render state-specific content
  const renderStateContent = (state: any) => {
    // Helper function to render calendar section
    const renderCalendarSection = (calendar: Calendar) => (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          📅 {calendar.name}
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          <p>Created: {new Date(calendar.created_at).toLocaleDateString()}</p>
          <p>Last Updated: {new Date(calendar.updated_at).toLocaleDateString()}</p>
        </div>
        
        {/* Calendar Events Section */}
        <div className="mt-4">
          <h4 className="font-medium text-gray-900 mb-3">📋 Calendar Events</h4>
          <div className="text-gray-500 italic text-sm">
            Events will appear here as they become available in the stream
          </div>
        </div>
      </div>
    );

    // Helper function to render invitees section
    const renderInviteesSection = (invitees: User[], inviteeCalendars: Record<string, Calendar>) => (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h4 className="font-medium text-gray-900 mb-3">👥 Invitees ({invitees.length})</h4>
        <div className="space-y-3">
          {invitees.map((invitee) => (
            <div key={invitee.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
              <img 
                src={invitee.avatar_url} 
                alt={`${invitee.given_name}'s avatar`}
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTMyIDMyQzM1LjMxMzcgMzIgMzggMjkuMzEzNyAzOCAyNkMzOCAyMi42ODYzIDM1LjMxMzcgMjAgMzIgMjBDMjguNjg2MyAyMCAyNiAyMi42ODYzIDI2IDI2QzI2IDI5LjMxMzcgMjguNjg2MyAzMiAzMiAzMloiIGZpbGw9IiN5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDM0QzI0LjI2ODcgMzQgMTggNDAuMjY4NyAxOCA0OEg0NkM0NiA0MC4yNjg3IDM5LjczMTMgMzQgMzIgMzRaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
                }}
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">{invitee.given_name}</p>
                <p className="text-sm text-gray-600">{invitee.timezone}</p>
              </div>
              {inviteeCalendars[invitee.id] && (
                <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  {inviteeCalendars[invitee.id].name}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );

    // Handle different state types
    if (state.type === 'InitialState') {
      // Nothing to show for initial state
      const initialState = state as any;
      return null;
    }

    if (state.type === 'StateWithCalendar') {
      const calendarState = state as StateWithCalendar;
      return (
        <div className="space-y-4">
          {renderCalendarSection(calendarState.calendar)}
        </div>
      );
    }

    if (state.type === 'StateWithInvitees') {
      const inviteeState = state as StateWithInvitees;
      return (
        <div className="space-y-4">
          {renderCalendarSection(inviteeState.calendar)}
          {renderInviteesSection(inviteeState.invitees, inviteeState.invitee_calendars)}
        </div>
      );
    }

    if (state.type === 'StateWithPendingReschedulingProposals') {
      const reschedulingState = state as StateWithPendingReschedulingProposals;
      return (
        <div className="space-y-4">
          {renderCalendarSection(reschedulingState.calendar)}
          {renderInviteesSection(reschedulingState.invitees, reschedulingState.invitee_calendars)}
          
          {/* Pending Rescheduling Proposals */}
          <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
            <h4 className="font-medium text-yellow-900 mb-3">
              ⏳ Pending Rescheduling Proposals ({reschedulingState.pending_rescheduling_proposals.length})
            </h4>
            <div className="space-y-2 text-sm text-yellow-800">
              {reschedulingState.pending_rescheduling_proposals.map((proposal, index) => (
                <div key={index} className="p-3 bg-yellow-100 rounded">
                  <p><strong>Event:</strong> {proposal.original_event?.title || 'Unknown Event'}</p>
                  <p><strong>New Time:</strong> {new Date(proposal.new_start_time).toLocaleString()} - {new Date(proposal.new_end_time).toLocaleString()}</p>
                  <p><strong>Reason:</strong> {proposal.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (state.type === 'StateWithCompletedReschedulingProposals') {
      const completedState = state as StateWithCompletedReschedulingProposals;
      return (
        <div className="space-y-4">
          {renderCalendarSection(completedState.calendar)}
          {renderInviteesSection(completedState.invitees, completedState.invitee_calendars)}
          
          {/* Completed Rescheduling Proposals */}
          <div className="bg-green-50 p-6 rounded-lg border border-green-200">
            <h4 className="font-medium text-green-900 mb-3">
              ✅ Completed Rescheduling Proposals ({completedState.completed_rescheduling_proposals.length})
            </h4>
            <div className="space-y-2 text-sm text-green-800">
              {completedState.completed_rescheduling_proposals.map((proposal, index) => (
                <div key={index} className="p-3 bg-green-100 rounded">
                  <p><strong>Event:</strong> {proposal.original_event?.title || 'Unknown Event'}</p>
                  <p><strong>New Time:</strong> {new Date(proposal.new_start_time).toLocaleString()} - {new Date(proposal.new_end_time).toLocaleString()}</p>
                  <p><strong>Status:</strong> {proposal.type === 'AcceptedRescheduledEvent' ? '✅ Accepted' : '❌ Rejected'}</p>
                  <p><strong>Reason:</strong> {proposal.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Default state display
    return (
      <div className="p-4 bg-gray-100 rounded-lg text-left">
        <h2 className="font-semibold mb-2">Current State:</h2>
        <pre className="text-xs overflow-y-auto whitespace-pre-wrap h-[500px]">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    );
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
          
          {/* Centered LLM Response column with state info below */}
          <div className="mx-auto w-[600px]">
            {llmContent && (
              <div className="p-4 bg-white border rounded-lg text-left mb-6">
                <h2 className="font-semibold mb-2">LLM Response:</h2>
                <p className="whitespace-pre-wrap">{llmContent}</p>
              </div>
            )}
            
            {/* Structured State Information below LLM Response */}
            {currentState && (
              <div className="w-full">
                {renderStateContent(currentState)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
