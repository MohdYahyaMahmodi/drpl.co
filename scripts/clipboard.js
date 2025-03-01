// Polyfill for Navigator.clipboard.writeText
if (!navigator.clipboard) {
  navigator.clipboard = {
    writeText: text => {
      const span = document.createElement('span');
      span.textContent = text;
      span.style.whiteSpace = 'pre';
      span.style.position = 'absolute';
      span.style.left = '-9999px';
      span.style.top = '-9999px';

      const selection = window.getSelection();
      document.body.appendChild(span);

      const range = document.createRange();
      selection.removeAllRanges();
      range.selectNode(span);
      selection.addRange(range);

      try {
        document.execCommand('copy');
      } catch (err) {
        return Promise.error();
      }

      selection.removeAllRanges();
      span.remove();
      return Promise.resolve();
    }
  };
}
