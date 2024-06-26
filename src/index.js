export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Extract the Authorization header
    const authorizationHeader = request.headers.get('Authorization');
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return new Response('Missing or invalid Authorization header', { status: 401 });
    }
    const apiKey = authorizationHeader.replace('Bearer ', '').trim();

    if (url.pathname === '/claude') {
      return handleAnthropicRequest(request, env, apiKey);
    } else {
      return handleAzureRequest(request, env, apiKey);
    }
  }
};

async function handleAzureRequest(request, env, apiKey) {
  const openaiRequest = await request.json();

  const azureRequest = {
    ...openaiRequest,
  };

  const azureResourceName = env.AZURE_RESOURCE_NAME;
  const azureDeploymentName = env.AZURE_DEPLOYMENT_NAME;

  try {
    const azureResponse = await fetch(`https://${azureResourceName}.openai.azure.com/openai/deployments/${azureDeploymentName}/chat/completions?api-version=2024-02-15-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(azureRequest)
    });

    if (!azureResponse.ok) {
      return new Response(await azureResponse.text(), {
        status: azureResponse.status,
        statusText: azureResponse.statusText,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const azureData = await azureResponse.json();

    const openaiResponse = {
      id: azureData.id,
      object: azureData.object,
      created: azureData.created,
      model: azureData.model,
      usage: azureData.usage,
      choices: azureData.choices.map(choice => ({
        message: choice.message,
        finish_reason: choice.finish_reason,
        index: choice.index
      }))
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleAnthropicRequest(request, env, apiKey) {
  const openaiRequest = await request.json();

  let systemContent = null;
  const userMessages = [];

  // Convert OpenAI messages to Anthropic format
  for (const message of openaiRequest.messages) {
    if (message.role === 'system') {
      systemContent = message.content;
    } else {
      userMessages.push(message);
    }
  }

  const anthropicPayload = {
    ...openaiRequest,
    system: systemContent || '',
    messages: userMessages
  };

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicPayload)
    });

    if (!anthropicResponse.ok) {
      return new Response(await anthropicResponse.text(), {
        status: anthropicResponse.status,
        statusText: anthropicResponse.statusText,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const anthropicData = await anthropicResponse.json();

    const openaiResponse = {
      id: anthropicData.id,
      object: anthropicData.type,
      created: new Date().getTime(),
      model: anthropicData.model,
      usage: anthropicData.usage,
      choices: [
        {
          message: {
            role: 'assistant',
            content: anthropicData.content.map(c => c.text).join('\n')
          },
          finish_reason: anthropicData.stop_reason,
          index: 0
        }
      ]
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
