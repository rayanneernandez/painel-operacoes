const DEFAULT_ZAPRESPONDER_BASE_URL = "https://api.zapresponder.com.br";

function safeTrim(value) {
  return String(value ?? "").trim();
}

export function normalizeBrazilPhone(value) {
  const digits = safeTrim(value).replace(/\D/g, "");
  if (!digits) return "";

  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  if (withoutCountry.length === 10 || withoutCountry.length === 11) {
    return `55${withoutCountry}`;
  }

  return digits;
}

function buildCredentialVariants(token) {
  const cleanToken = safeTrim(token);
  if (!cleanToken) return [];

  return [
    { Authorization: cleanToken },
    { Authorization: `Bearer ${cleanToken}` },
    { token: cleanToken },
    { "x-api-key": cleanToken },
    { "X-API-Key": cleanToken },
  ];
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null,
    };
  } catch {
    return {
      text,
      json: null,
    };
  }
}

export function getZapResponderConfigFromEnv() {
  const apiBaseUrl =
    safeTrim(process.env.ZAPRESPONDER_API_BASE_URL) ||
    DEFAULT_ZAPRESPONDER_BASE_URL;
  const apiToken = safeTrim(process.env.ZAPRESPONDER_API_TOKEN);
  const departmentId = safeTrim(process.env.ZAPRESPONDER_DEPARTMENT_ID);
  const departmentName =
    safeTrim(process.env.ZAPRESPONDER_DEPARTMENT_NAME) || "Global IA Chat";
  const phoneLabel =
    safeTrim(process.env.ZAPRESPONDER_PHONE_LABEL) || "Global IA";

  const missing = [];
  if (!apiToken) missing.push("ZAPRESPONDER_API_TOKEN");
  if (!departmentId) missing.push("ZAPRESPONDER_DEPARTMENT_ID");

  return {
    apiBaseUrl,
    apiToken,
    departmentId,
    departmentName,
    phoneLabel,
    configured: missing.length === 0,
    missing,
  };
}

export async function callZapResponder(path, options = {}) {
  const config = getZapResponderConfigFromEnv();
  const token = safeTrim(options.token) || config.apiToken;
  const credentialVariants = buildCredentialVariants(token);
  if (credentialVariants.length === 0) {
    throw new Error("ZAPRESPONDER_API_TOKEN nao configurado");
  }

  const method = safeTrim(options.method).toUpperCase() || "GET";
  const urlBase = safeTrim(options.apiBaseUrl) || config.apiBaseUrl;
  const url = `${urlBase.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const rawBody = options.body == null ? undefined : JSON.stringify(options.body);

  let lastError = null;

  for (const authHeaders of credentialVariants) {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...authHeaders,
      },
      ...(rawBody ? { body: rawBody } : {}),
    });

    const parsed = await parseResponse(response);
    if (response.ok) {
      return {
        status: response.status,
        data: parsed.json,
        text: parsed.text,
      };
    }

    const details = parsed.text || JSON.stringify(parsed.json || {});
    lastError = new Error(
      `ZapResponder ${response.status} ${response.statusText}: ${details.slice(0, 500)}`
    );

    if (![401, 403].includes(response.status)) break;
  }

  throw lastError || new Error("Falha ao chamar ZapResponder");
}

export async function sendZapTextMessage({
  number,
  message,
  showInChat = true,
  departmentId,
  token,
  apiBaseUrl,
}) {
  const config = getZapResponderConfigFromEnv();
  const normalizedNumber = normalizeBrazilPhone(number);
  if (!normalizedNumber) {
    throw new Error("Numero de telefone invalido");
  }

  const resolvedDepartmentId = safeTrim(departmentId) || config.departmentId;
  if (!resolvedDepartmentId) {
    throw new Error("ZAPRESPONDER_DEPARTMENT_ID nao configurado");
  }

  return callZapResponder(`/api/whatsapp/message/${resolvedDepartmentId}`, {
    method: "POST",
    token,
    apiBaseUrl,
    body: {
      type: "text",
      message: safeTrim(message),
      number: normalizedNumber,
      showInChat: Boolean(showInChat),
    },
  });
}
