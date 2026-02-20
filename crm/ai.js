const GROQ_API_KEY = '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';

// Generate concise visit summary
async function generateConciseVisitSummary(company, contact, notes) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'Generate a very concise summary of a sales visit in 2-3 bullet points. Focus on key outcomes and next steps. Use bullet points with * and keep it under 100 words total.'
          },
          {
            role: 'user',
            content: `Summarize this visit to ${company} with ${contact || 'contact'}:
            
            Notes: ${notes.substring(0, 500)}`
          }
        ],
        max_tokens: 150,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating visit summary:', error);
    return 'Unable to generate summary.';
  }
}

// Predictive Lead Scoring
async function predictLeadScore(company, contact, notes, visitType) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a sales AI that predicts lead conversion probability. Analyze the visit details and return ONLY a number between 0-100 representing the lead score. Consider: engagement level, decision-maker access, budget signals, timeline urgency, and pain points mentioned.'
          },
          {
            role: 'user',
            content: `Analyze this sales visit and predict lead score (0-100):
            
            Company: ${company}
            Contact: ${contact || 'Unknown'}
            Visit Type: ${visitType}
            Notes: ${notes.substring(0, 400)}
            
            Return only the numeric score.`
          }
        ],
        max_tokens: 10,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const scoreText = data.choices[0].message.content.trim();
    const score = parseInt(scoreText.match(/\d+/)?.[0] || '50');
    
    return Math.min(100, Math.max(0, score));
  } catch (error) {
    console.error('Error predicting lead score:', error);
    return 50; // Default score
  }
}

// Generate team trends
async function generateConciseTeamTrends(allNotes) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'Generate very concise team insights in 3-4 bullet points. Focus on common patterns, key challenges, and opportunities. Use bullet points with * and keep it under 120 words total.'
          },
          {
            role: 'user',
            content: `Analyze these field visit notes and provide team insights:
            
            Notes: ${allNotes.substring(0, 1000)}`
          }
        ],
        max_tokens: 180,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error analyzing team trends:', error);
    return 'Unable to analyze team trends at this time.';
  }
}

// Generate a short neutral company description from the company name
async function generateCompanyDescription(companyName) {
  try {
    if (!companyName || !companyName.trim()) return '';

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that writes short, factual and neutral company descriptions based only on the company name. Keep it to 1 short sentence (under 25 words). Do NOT invent unverifiable specifics such as exact products, locations, or financials. If uncertain, use generic phrasing.'
          },
          {
            role: 'user',
            content: `Write a short, neutral description for this company name: "${companyName}". Keep it concise (1 sentence) and avoid fabricating details.`
          }
        ],
        max_tokens: 80,
        temperature: 0.6
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '';
  } catch (error) {
    console.error('Error generating company description:', error);
    return '';
  }
}