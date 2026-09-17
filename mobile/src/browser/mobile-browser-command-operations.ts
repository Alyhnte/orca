import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcMethodName } from '../transport/rpc-params-contract'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import {
  browserCommandUnreadReplySchema,
  browserNavigationSettledSchema
} from './browser-command-reply-schema'

/**
 * Every command the phone sends to a hosted browser page.
 *
 * All of them share one acceptance because the screen treats them alike: a refusal is raised with
 * the host's own message, which the caller then either shows or swallows as a transient automation
 * failure. What differs between them is the copy a message-less refusal falls back to, and that
 * stays at the call site. None reads the reply beyond `browser.goto`'s settled URL.
 *
 * These are mutations against a live page, so a lost reply is unknown rather than failed: no call
 * site retries one, and the delivery-unknown mark on a transport rejection is left intact.
 *
 * The reader is a parameter rather than one shared reader, because `browser.goto` is the only one
 * whose body is read; the other twelve take the unread default and stay one line each.
 */
function browserPageCommand<Method extends RpcMethodName, Variant extends string, Value>(
  name: string,
  method: Method,
  read: RpcCompatibleReader<unknown, Variant, Value>
) {
  return bindDeferredRpcOperation(
    defineRpcOperation({
      name,
      method,
      acceptance: 'require-result-or-throw-message',
      barrier: 'after-caller-barrier',
      read
    })
  )
}

const unreadBrowserCommandReader = rpcResultVariant(
  'browser-command',
  browserCommandUnreadReplySchema
)

export const browserNavigate = browserPageCommand(
  'browser.navigate',
  'browser.goto',
  rpcResultVariant('browser-navigation-settled', browserNavigationSettledSchema)
)
export const browserGoBack = browserPageCommand(
  'browser.go-back',
  'browser.back',
  unreadBrowserCommandReader
)
export const browserGoForward = browserPageCommand(
  'browser.go-forward',
  'browser.forward',
  unreadBrowserCommandReader
)
export const browserReload = browserPageCommand(
  'browser.reload-page',
  'browser.reload',
  unreadBrowserCommandReader
)
export const browserPointerClick = browserPageCommand(
  'browser.pointer-click',
  'browser.mouseClick',
  unreadBrowserCommandReader
)
export const browserPointerMove = browserPageCommand(
  'browser.pointer-move',
  'browser.mouseMove',
  unreadBrowserCommandReader
)
export const browserPointerDown = browserPageCommand(
  'browser.pointer-down',
  'browser.mouseDown',
  unreadBrowserCommandReader
)
export const browserPointerUp = browserPageCommand(
  'browser.pointer-up',
  'browser.mouseUp',
  unreadBrowserCommandReader
)
export const browserPointerWheel = browserPageCommand(
  'browser.pointer-wheel',
  'browser.mouseWheel',
  unreadBrowserCommandReader
)
export const browserInsertText = browserPageCommand(
  'browser.insert-text',
  'browser.keyboardInsertText',
  unreadBrowserCommandReader
)
export const browserKeypress = browserPageCommand(
  'browser.keypress',
  'browser.keypress',
  unreadBrowserCommandReader
)
export const browserDialogAccept = browserPageCommand(
  'browser.dialog-accept',
  'browser.dialogAccept',
  unreadBrowserCommandReader
)
export const browserDialogDismiss = browserPageCommand(
  'browser.dialog-dismiss',
  'browser.dialogDismiss',
  unreadBrowserCommandReader
)
