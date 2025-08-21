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
  events?: CalendarEvent[];
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
  const [inviteeUsers, setInviteeUsers] = useState<Record<string, User>>({});
  const [loadingInvitees, setLoadingInvitees] = useState<Record<string, boolean>>({});

  // Function to fetch user information for invitees
  const fetchInviteeUser = async (userId: string) => {
    if (inviteeUsers[userId]) return; // Already fetched
    
    setLoadingInvitees(prev => ({ ...prev, [userId]: true }));
    
    try {
      const response = await fetch(`http://localhost:8000/api/v1/users/${userId}`);
      if (response.ok) {
        const userData = await response.json();
        setInviteeUsers(prev => ({ ...prev, [userId]: userData }));
      }
    } catch (error) {
      console.error(`Failed to fetch user ${userId}:`, error);
    } finally {
      setLoadingInvitees(prev => ({ ...prev, [userId]: false }));
    }
  };

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
    const renderCalendarSection = (calendar: any, currentUser: User, invitees?: User[]) => (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          📅 {calendar.name}
        </h3>
        
        {/* Calendar Events Section */}
        <div className="mt-4">
          <h4 className="font-medium text-gray-900 mb-3">📋 Calendar Events</h4>
          {calendar.events && calendar.events.length > 0 ? (
            <div className="space-y-3">
              {calendar.events.map((event: any) => (
                <div key={event.id} className="p-4 bg-gray-50 rounded-lg border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-900 mb-1">{event.title}</h5>
                      {event.description && (
                        <p className="text-sm text-gray-600 mb-2">{event.description}</p>
                      )}
                      
                      {/* Time Information */}
                      <div className="text-center mb-2">
                        <p className="text-sm text-gray-600">
                          Starts at <span className="font-semibold">{new Date(event.start_time).toLocaleTimeString([], {hour: 'numeric', hour12: true})}</span> and ends at <span className="font-semibold">{new Date(event.end_time).toLocaleTimeString([], {hour: 'numeric', hour12: true})}</span>.
                        </p>
                      </div>
                      
                      {/* Host Information */}
                      <div className="flex items-center justify-center space-x-2 mb-2">
                        <span className="text-sm font-medium text-gray-700">Hosted by:</span>
                        <div className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-full">
                          <img 
                            src={currentUser.avatar_url} 
                            alt={`${currentUser.given_name}'s avatar`}
                            className="w-8 h-8 rounded-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTMyIDMyQzM1LjMxMzcgMzIgMzggMjkuMzEzNyAzOCAyNkMzOCAyMi42ODYzIDM1LjMxMzcgMjAgMzIgMjBDMjguNjg2MyAyMCAyNiAyMi42ODYzIDI2IDI2QzI2IDI5LjMxMzcgMjguNjg2MyAzMiAzMiAzMloiIGZpbGw9IiN5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDM0QzI0LjI2ODcgMzQgMTggNDAuMjY4NyAxOCA0OEg0NkM0NiA0MC4yNjg3IDM5LjczMTMgMzQgMzIgMzRaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
                            }}
                          />
                          <span className="text-sm font-medium text-gray-700">{currentUser.given_name}</span>
                        </div>
                      </div>
                      
                      <div className="text-xs text-gray-500 space-y-1">
                        {/* Invitees Section */}
                        {invitees && invitees.length > 0 ? (
                          <div className="flex items-center justify-center space-x-2">
                            <span className="text-sm font-medium text-gray-700">Invitees:</span>
                            <div className="flex flex-wrap gap-2">
                              {invitees.map((invitee) => (
                                <div key={invitee.id} className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-full">
                                  <img 
                                    src={invitee.avatar_url} 
                                    alt={`${invitee.given_name}'s avatar`}
                                    className="w-4 h-4 rounded-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTMyIDMyQzM1LjMxMzcgMzIgMzggMjkuMzEzNyAzOCAyNkMzOCAyMi42ODYzIDM1LjMxMzcgMjAgMzIgMjBDMjguNjg2MyAyMCAyNiAyMi42ODYzIDI2IDI2QzI2IDI5LjMxMzcgMjguNjg2MyAzMiAzMiAzMloiIGZpbGw9IiN5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDM0QzI0LjI2ODcgMzQgMTggNDAuMjY4NyAxOCA0OEg0NkM0NiA0MC4yNjg3IDM5LjczMTMgMzQgMzIgMzRaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
                                    }}
                                  />
                                  <span className="text-xs text-gray-700">{invitee.given_name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : event.invitees && event.invitees.length > 0 ? (
                          <div className="flex items-center justify-center space-x-2">
                            <span className="text-sm font-medium text-gray-700">Invitees:</span>
                            <div className="flex flex-wrap gap-2">
                              {event.invitees.map((invitee: any) => {
                                const userId = invitee.id;
                                const userData = inviteeUsers[userId];
                                const isLoading = loadingInvitees[userId];
                                
                                // Fetch user data if not already loaded
                                if (!userData && !isLoading) {
                                  fetchInviteeUser(userId);
                                }
                                
                                if (isLoading) {
                                  return (
                                    <div key={userId} className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-full">
                                      <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse"></div>
                                      <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
                                    </div>
                                  );
                                }
                                
                                if (userData) {
                                  return (
                                    <div key={userId} className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-full">
                                      <img 
                                        src={userData.avatar_url} 
                                        alt={`${userData.given_name}'s avatar`}
                                        className="w-8 h-8 rounded-full object-cover"
                                        onError={(e) => {
                                          e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNEM0Q3RDAiLz4KPHBhdGggZD0iTTMyIDMyQzM1LjMxMzcgMzIgMzggMjkuMzEzNyAzOCAyNkMzOCAyMi42ODYzIDM1LjMxMzcgMjAgMzIgMjBDMjguNjg2MyAyMCAyNiAyMi42ODYzIDI2IDI2QzI2IDI5LjMxMzcgMjguNjg2MyAzMiAzMiAzMloiIGZpbGw9IiN5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDM0QzI0LjI2ODcgMzQgMTggNDAuMjY4NyAxOCA0OEg0NkM0NiA0MC4yNjg3IDM5LjczMTMgMzQgMzIgMzRaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
                                        }}
                                      />
                                      <span className="text-sm font-medium text-gray-700">{userData.given_name}</span>
                                    </div>
                                  );
                                }
                                
                                return null;
                              })}
                            </div>
                          </div>
                        ) : (
                          <p>👥 No invitees</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 italic text-sm">
              No events scheduled for this date
            </div>
          )}
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
          {renderCalendarSection(calendarState.calendar, calendarState.user)}
        </div>
      );
    }

    if (state.type === 'StateWithInvitees') {
      const inviteeState = state as StateWithInvitees;
      return (
        <div className="space-y-4">
          {renderCalendarSection(inviteeState.calendar, inviteeState.user, inviteeState.invitees)}
        </div>
      );
    }

    if (state.type === 'StateWithPendingReschedulingProposals') {
      const reschedulingState = state as StateWithPendingReschedulingProposals;
      return (
        <div className="space-y-4">
          {renderCalendarSection(reschedulingState.calendar, reschedulingState.user, reschedulingState.invitees)}
          
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
          {renderCalendarSection(completedState.calendar, completedState.user, completedState.invitees)}
          
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
    <div className="min-h-screen bg-gray-50">
      {/* Fixed header section */}
      <div className="sticky top-0 z-20 bg-gray-50 pt-8 pb-6">
        <div className="mx-auto text-center">
          <h1 className="text-5xl font-mono font-bold leading-tight text-gray-800">
            calendar-condenser
          </h1>
          
          {!isStarted ? (
            <button 
              onClick={handleStart}
              className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
            >
              start
            </button>
          ) : null}
        </div>
      </div>
      
      {isStarted && (
        <div className="relative">
          {/* Current State positioned on the left edge of the screen */}
          <div className="fixed left-0 top-32 w-[400px] ml-8">
            {currentState && (
              <div className="p-4 bg-gray-100 rounded-lg text-left">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">Current State:</h2>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(currentState, null, 2));
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded transition-colors duration-200"
                    title="Copy to clipboard"
                  >
                    📋 Copy
                  </button>
                </div>
                <pre className="text-xs overflow-y-auto whitespace-pre-wrap h-[500px]">
                  {JSON.stringify(currentState, null, 2)}
                </pre>
              </div>
            )}
          </div>
          
          {/* Centered LLM Response column with state info below */}
          <div className="mx-auto w-[600px]">
            <div className="overflow-y-auto pr-4">
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
        </div>
      )}
    </div>
  );
}

export default App;
