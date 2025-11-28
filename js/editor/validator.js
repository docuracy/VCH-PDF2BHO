export function validateXML(xhtml) {
    const resultEl = document.getElementById("validation-result");

    try {
        const xmlDoc = new DOMParser().parseFromString(xhtml, "application/xml");
        const parseError = xmlDoc.getElementsByTagName("parsererror")[0];

        if (parseError) {
            const errorDiv = parseError.querySelector("div");
            const errorText = errorDiv ? errorDiv.textContent : parseError.textContent;
            resultEl.textContent = "❌ " + errorText.trim();
            resultEl.className = "invalid";
            return false;
        } else {
            resultEl.textContent = "✓ Valid XHTML";
            resultEl.className = "valid";
            // Clear success message after 3 seconds
            setTimeout(() => {
                resultEl.textContent = "";
                resultEl.className = "";
            }, 3000);
            return true;
        }

    } catch (e) {
        resultEl.textContent = "❌ Parse error: " + e.message;
        resultEl.className = "invalid";
        return false;
    }
}