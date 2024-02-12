import { Message, WireType } from '@bufbuild/protobuf'
import { $ } from '../lib/env'

export abstract class YouTubeMessage {
  name: string
  needProcess: boolean
  needSave: boolean
  message: any
  whiteNo: number[]
  blackNo: number[]
  whiteEml: string[]
  blackEml: string[]
  msgType: Message<any>
  decoder = new TextDecoder('utf-8', {
    fatal: false,
    ignoreBOM: true
  })

  protected constructor (msgType: Message<any>, name: string) {
    $.log(name)
    this.name = name
    this.msgType = msgType
    Object.assign(this, $.getJSON('YouTubeAdvertiseInfo', {
      whiteNo: [],
      blackNo: [],
      whiteEml: [],
      blackEml: ['cell_divider.eml']
    }))
  }

  fromBinary (binaryBody: Uint8Array): YouTubeMessage {
    this.message = this.msgType.fromBinary(binaryBody)
    return this
  }

  abstract pure (): this

  toBinary (): Uint8Array {
    return this.message.toBinary()
  }

  listUnknownFields (msg: Message<any>): ReadonlyArray<{ no: number, wireType: WireType, data: Uint8Array }> {
    return msg.getType().runtime.bin.listUnknownFields(msg)
  }

  save (): void {
    if (this.needSave) {
      $.log('Update Config')
      const YouTubeAdvertiseInfo = {
        whiteNo: this.whiteNo,
        blackNo: this.blackNo,
        whiteEml: this.whiteEml,
        blackEml: this.blackEml
      }
      $.setJSON(YouTubeAdvertiseInfo, 'YouTubeAdvertiseInfo')
    }
  }

  done (response: CFetchResponse): void {
    this.save()
    let body = response.bodyBytes
    if (this.needProcess) body = this.toBinary()

    response.headers['Content-Encoding'] = 'identity'
    response.headers['Content-Length'] = (body?.length ?? 0)?.toString()

    $.done({
      response: {
        ...response,
        bodyBytes: body
      }
    })
  }

  doneResponse (): void {
    this.save()
    if (this.needProcess) {
      $.done({ bodyBytes: this.toBinary() })
    }
    $.exit()
  }

  iterate (obj: any = {}, target: string | symbol, call: Function): any {
    const stack: any[] = (typeof obj === 'object') ? [obj] : []
    while (stack.length) {
      const item = stack.pop()
      const keys = Object.keys(item)

      if (typeof target === 'symbol') {
        for (const s of Object.getOwnPropertySymbols(item)) {
          if (s.description === target.description) {
            call(item, stack)
            break
          }
        }
      }

      for (const key of keys) {
        if (key === target) {
          call(item, stack)
        } else if (typeof item[key] === 'object') {
          stack.push(item[key])
        }
      }
    }
  }

  isAdvertise (o: Message<any>): boolean {
    const filed = this.listUnknownFields(o)[0]
    const adFlag = filed ? this.handleFieldNo(filed) : this.handleFieldEml(o)
    if (adFlag) this.needProcess = true
    return adFlag
  }

  handleFieldNo (field): boolean {
    const no = field.no
    // 增加白名单直接跳过用于提升性能
    if (this.whiteNo.includes(no)) {
      return false
    } else if (this.blackNo.includes(no)) return true
    // 包含 pagead 字符则判定为广告
    const rawText = this.decoder.decode(field.data)
    const adFlag = rawText.includes('pagead')
    adFlag ? this.blackNo.push(no) : this.whiteNo.push(no)
    this.needSave = true
    return adFlag
  }

  handleFieldEml (field): boolean {
    let adFlag = false
    let type = ''
    this.iterate(field, 'renderInfo', (obj, stack) => {
      type = obj.renderInfo.layoutRender.eml.split('|')[0]
      if (this.whiteEml.includes(type)) {
        adFlag = false
      } else if (this.blackEml.includes(type)) {
        adFlag = true
      } else {
        const videoContent = obj.videoInfo.videoContext.videoContent
        const unknownField = this.listUnknownFields(videoContent)[0]
        const rawText = this.decoder.decode(unknownField.data)
        adFlag = rawText.includes('pagead')
        adFlag ? this.blackEml.push(type) : this.whiteEml.push(type)
        this.needSave = true
      }
      stack.length = 0
    })

    // if (!match) {
    //   this.iterate(
    //     field,
    //     Symbol.for('@bufbuild/protobuf/unknown-fields'),
    //     (obj, stack) => {
    //       const unknownFieldArray = this.listUnknownFields(obj)
    //       for (const unknownField of unknownFieldArray) {
    //         if (unknownField.data.length > 1000) {
    //           const rawText = this.decoder.decode(unknownField.data)
    //           adFlag = rawText.includes('pagead')
    //           if (adFlag) {
    //             stack.length = 0
    //             break
    //           }
    //         }
    //       }
    //     }
    //   )
    //   adFlag ? this.blackEml.push(type) : this.whiteEml.push(type)
    //   this.needSave = true
    // }
    return adFlag
  }

  isShorts (field): boolean {
    let flag = false
    this.iterate(field, 'eml', (obj, stack) => {
      flag = /shorts(?!_pivot_item)/.test(obj.eml)
      stack.length = 0
    })
    return flag
  }
}
