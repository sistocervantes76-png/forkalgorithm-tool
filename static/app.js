const recipeForm = document.getElementById('recipe-form');
const subscribeForm = document.getElementById('subscribe-form');
const queryInput = document.getElementById('query');
const emailInput = document.getElementById('email');
const result = document.getElementById('result');
const loading = document.getElementById('loading');
const recipeText = document.getElementById('recipe-text');
const errorText = document.getElementById('error-text');
const recipeButton = recipeForm.querySelector('button[type="submit"]');
const subscribeButton = subscribeForm.querySelector('button[type="submit"]');

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  recipeButton.disabled = true;
  result.hidden = false;
  loading.hidden = false;
  recipeText.textContent = '';
  errorText.textContent = '';

  try {
    const res = await fetch('/recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.error) {
      errorText.textContent = data.error;
    } else {
      recipeText.textContent = data.recipe;
    }
  } catch {
    errorText.textContent = 'Network error. Please try again.';
  } finally {
    loading.hidden = true;
    recipeButton.disabled = false;
  }
});

subscribeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  subscribeButton.disabled = true;

  try {
    const res = await fetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.error) {
      showModal('Oops', data.error);
    } else {
      showModal('You’re in!', data.message || 'Thanks for subscribing!');
      emailInput.value = '';
    }
  } catch {
    showModal('Oops', 'Unable to subscribe. Please try again later.');
  } finally {
    subscribeButton.disabled = false;
  }
});

queryInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    recipeForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

const confirmationModal = document.getElementById('confirmation-modal');
const modalClose = document.getElementById('modal-close');

function showModal(title, message) {
  confirmationModal.querySelector('h2').textContent = title;
  confirmationModal.querySelector('p').textContent = message;
  confirmationModal.setAttribute('aria-hidden', 'false');
  confirmationModal.classList.add('open');
}

function hideModal() {
  confirmationModal.setAttribute('aria-hidden', 'true');
  confirmationModal.classList.remove('open');
}

modalClose.addEventListener('click', hideModal);
confirmationModal.querySelector('.modal-backdrop').addEventListener('click', hideModal);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && confirmationModal.classList.contains('open')) {
    hideModal();
  }
});
