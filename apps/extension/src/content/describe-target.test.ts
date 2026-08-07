// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { describeSelection, describeTarget } from './describe-target.js';

function render(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('form fields', () => {
  it.each([
    ['<input id="t" type="text" value="typed secret" />', 'input'],
    ['<input id="t" type="password" value="hunter2" />', 'input'],
    ['<textarea id="t">a draft message</textarea>', 'textarea'],
    ['<select id="t"><option>chosen</option></select>', 'select'],
    ['<div id="t" contenteditable="true">note to self</div>', 'div'],
  ])('records that %s was clicked but nothing about its contents', (html, tag) => {
    render(html);
    const target = document.getElementById('t');

    const description = describeTarget(target);

    expect(description).toEqual({ tag, isFormField: true });
  });

  it('says nothing about an element nested inside a field', () => {
    render('<div contenteditable="true"><span id="t">private draft</span></div>');

    const description = describeTarget(document.getElementById('t'));

    expect(description).toEqual({ tag: 'span', isFormField: true });
  });

  it('never returns a label for a field, whatever it contains', () => {
    render('<input id="t" type="text" value="4111 1111 1111 1111" />');

    const description = describeTarget(document.getElementById('t'));

    expect(JSON.stringify(description)).not.toContain('4111');
  });
});

describe('ordinary elements', () => {
  it('takes the visible label from a button', () => {
    render('<button id="t">Submit issue</button>');

    expect(describeTarget(document.getElementById('t'))).toMatchObject({
      tag: 'button',
      label: 'Submit issue',
      isFormField: false,
    });
  });

  it('prefers an explicit aria-label', () => {
    render('<button id="t" aria-label="Close dialog">×</button>');

    expect(describeTarget(document.getElementById('t'))).toMatchObject({
      label: 'Close dialog',
    });
  });

  it('records the role when one is set', () => {
    render('<div id="t" role="tab">Issues</div>');

    expect(describeTarget(document.getElementById('t'))).toMatchObject({ role: 'tab' });
  });

  it('collapses whitespace in the label', () => {
    render('<button id="t">  Submit\n\n   issue  </button>');

    expect(describeTarget(document.getElementById('t'))).toMatchObject({ label: 'Submit issue' });
  });

  it('truncates a very long label', () => {
    render(`<button id="t">${'x'.repeat(500)}</button>`);

    expect(describeTarget(document.getElementById('t'))?.label).toHaveLength(120);
  });

  it('returns no label when there is no visible text', () => {
    render('<span id="t"><img src="x.png" /></span>');

    expect(describeTarget(document.getElementById('t'))?.label).toBeUndefined();
  });

  it('returns null for a non-element target', () => {
    expect(describeTarget(null)).toBeNull();
    expect(describeTarget(new EventTarget())).toBeNull();
  });
});

describe('link destinations', () => {
  it('records where a link points', () => {
    render('<a id="t" href="https://example.com/issues/12">Issue 12</a>');

    expect(describeTarget(document.getElementById('t'))).toMatchObject({
      href: 'https://example.com/issues/12',
    });
  });

  it('strips the query string from the link', () => {
    render('<a id="t" href="https://example.com/r?token=secret">Reset</a>');

    expect(describeTarget(document.getElementById('t'))?.href).toBe('https://example.com/r');
  });

  it('resolves a relative link', () => {
    render('<a id="t" href="/docs/api">API</a>');

    expect(describeTarget(document.getElementById('t'))?.href).toContain('/docs/api');
  });

  it('finds the link when the click lands on a child element', () => {
    render('<a href="https://example.com/x"><span id="t">label</span></a>');

    expect(describeTarget(document.getElementById('t'))?.href).toBe('https://example.com/x');
  });

  it('ignores a mailto link, which is a personal address', () => {
    render('<a id="t" href="mailto:someone@example.com">Email us</a>');

    expect(describeTarget(document.getElementById('t'))?.href).toBeUndefined();
  });

  it('ignores a javascript: link', () => {
    render('<a id="t" href="javascript:void(0)">Menu</a>');

    expect(describeTarget(document.getElementById('t'))?.href).toBeUndefined();
  });
});

/** A stand-in for a real Selection, which happy-dom does not fully implement. */
function fakeSelection(text: string, anchorNode: Node | null): Selection {
  return {
    isCollapsed: text.length === 0,
    anchorNode,
    toString: () => text,
  } as unknown as Selection;
}

describe('text selection', () => {
  it('reports only the length when text capture is off', () => {
    render('<p id="t">a paragraph the user highlighted</p>');
    const node = document.getElementById('t');

    const result = describeSelection(fakeSelection('the user highlighted', node), false);

    expect(result).toEqual({ length: 20 });
  });

  it('includes the text when the user has opted in', () => {
    render('<p id="t">a paragraph</p>');
    const node = document.getElementById('t');

    const result = describeSelection(fakeSelection('a paragraph', node), true);

    expect(result).toEqual({ length: 11, text: 'a paragraph' });
  });

  it('truncates a long selection', () => {
    render('<p id="t">x</p>');
    const node = document.getElementById('t');

    const result = describeSelection(fakeSelection('y'.repeat(1000), node), true);

    expect(result?.text).toHaveLength(280);
    expect(result?.length).toBe(1000);
  });

  it('ignores a selection inside a text field, which is the user typing', () => {
    render('<input id="t" type="text" value="typed" />');
    const node = document.getElementById('t');

    expect(describeSelection(fakeSelection('typed', node), true)).toBeNull();
  });

  it('ignores a selection inside a contenteditable draft', () => {
    render('<div contenteditable="true"><span id="t">draft</span></div>');
    const node = document.getElementById('t');

    expect(describeSelection(fakeSelection('draft', node), true)).toBeNull();
  });

  it('ignores an empty or collapsed selection', () => {
    expect(describeSelection(fakeSelection('', null), true)).toBeNull();
    expect(describeSelection(null, true)).toBeNull();
  });

  it('ignores a whitespace-only selection', () => {
    render('<p id="t">x</p>');

    expect(
      describeSelection(fakeSelection('   \n  ', document.getElementById('t')), true),
    ).toBeNull();
  });
});
