
document.addEventListener("DOMContentLoaded", function () {
    const parser = new PromptParser()

    onAfterUiUpdate(() => {
        parser.run()
    })

})

class PromptParser {
    static keyIndex = 0
    static increment = false

    get isDarkMode() {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const theme = urlParams.get('__theme')

        return theme === 'dark'
    }

    inputs = {
        'txt2img_prompt': null,
        'txt2img_neg_prompt': null,
        'img2img_prompt': null,
        'img2img_neg_prompt': null
    }

    run = () => {
        Object.keys(this.inputs).forEach(key => {
            if (!this.inputs[key]) {
                this.initElement(key)
            }
        })
    }

    initElement = (key) => {
        const container = document.querySelector(`#${key}`)
        if (!container) {
            return
        }

        const textarea = document.querySelector(`#${key} textarea`)
        const elem = this.inputs[key] = {
            container,
            textarea
        }

        elem.handler = () => this.onPromptChanged(elem)

        elem.observer = new MutationObserver(elem.handler);
        elem.observer.observe(elem.textarea, { attributes: ['value'] });

        const style = window.getComputedStyle(elem.textarea)

        const wrapper = document.createElement('div')
        wrapper.classList.add('prompt-style-wrapper')

        const prompt = document.createElement('div')

        prompt.style.fontFamily = style.fontFamily
        prompt.style.letterSpacing = style.letterSpacing
        prompt.style.direction = style.direction
        prompt.classList.add('prompt-style')

        if (this.isDarkMode) {
            elem.container.classList.add('dark-theme')
        }
       
        elem.container.classList.add('style-root')

        elem.textarea.addEventListener('scroll', function (e) {
            const top = e.currentTarget.scrollTop
            prompt.style.top = `${parseInt(style.paddingTop.replace('px', '')) - top}px`;
        });

        elem.prompt = prompt

        wrapper.appendChild(prompt)
        elem.container.appendChild(wrapper)

        elem.textarea.addEventListener('input', elem.handler)

        elem.handler()
    }

    onPromptChanged = (elem) => {
        const node = this.parse(elem.textarea.value.toString())
        PromptParser.keyIndex = 0
        PromptParser.increment = false
        elem.prompt.innerHTML = node.toString()

        const debug = document.getElementById('debug-promptNodes')
        if (debug) {
            PromptParser.keyIndex = 0
            PromptParser.increment = false
            debug.innerHTML = `<pre>${JSON.stringify(node.toJson(), null, 2)}</pre>`
        }
    }

    parse = (prompt) => {
        const root = new PromptNode(prompt)
        let parent = root
        const stack = [parent]
        let i = 0;
        while (i < prompt.length) {
            let node = new PromptNode(prompt, parent)
            i = node.parse(i)

            if (node.type === PromptNode.BlockStart) {
                const newParent = new PromptNode(prompt, parent, PromptNode.Block)
                newParent.index = i
                newParent.startIndex = i
                if (node.content === '<') {
                    newParent.blockType = PromptNode.Network
                }

                if (node.content === '[') {
                    newParent.blockType = PromptNode.Brackets
                }

                parent.addNode(newParent)
                parent = newParent
                stack.push(newParent)

                node.parent = parent
                node.invalid = true
                parent.addNode(node)

            } else if (node.type === PromptNode.BlockEnd) {
                node.parent = parent
                node.invalid = true
                const open = parent.children[0]
                if (open.type === PromptNode.BlockStart) {
                    node.invalid = open.content !== PromptNode.blockPairs[node.content]
                    if (!node.invalid) {
                        open.invalid = false
                    }
                }

                if (node.parent.blockType === PromptNode.Block || node.parent.blockType === PromptNode.Brackets) {
                    let pos = -1
                    let prev = node.parent.getChild(pos)
                    if (prev?.type === PromptNode.Whitespace) {
                        if (prev.content.length > 1) {
                            prev.invalid = true
                        }
                        prev = node.parent.getChild(--pos)
                    }

                    let colon = node.parent.getChild(--pos)
                    if (colon?.type === PromptNode.Whitespace) {
                        if (colon.content.length > 1) {
                            colon.invalid = true
                        }
                        colon = node.parent.getChild(--pos)
                    }

                    if (prev?.type === PromptNode.Keyword && colon?.type === PromptNode.Colon) {
                        prev.type = PromptNode.Weight
                        prev.invalid = !prev.isNumeric
                    }
                }

                parent.addNode(node)

                stack.pop()
                parent = stack.slice(-1)[0] ?? root

            } else {
                parent.addNode(node)
                const first = parent.getChild(1)
                if (parent.type === PromptNode.Block && first?.type === PromptNode.Whitespace && first.length > 1) {
                    first.invalid = true
                }
                if (parent.blockType === PromptNode.Network) {
                    this.updateNetworkNodes(node)
                }
            }
        }

        return root
    }

    updateNetworkNodes = (node) => {
        if (node.parent.blockType !== PromptNode.Network) return
        const children = node.parent.children
        const index = children.indexOf(node)
        if (index < 0) return;

        if (index === 1 && node.type === PromptNode.Keyword) {
            node.type = PromptNode.NetworkType
            return
        }

        const colons = children.map((o, i) => o.type === PromptNode.Colon ? i : undefined).filter(o => o !== undefined)

        if (colons[0] && (!colons[1] || index < colons[1])) {
            if (node.type === PromptNode.Keyword) {
                node.type = PromptNode.Network
            }
        }

        if (colons[1] && node.type === PromptNode.Keyword) {
            if (index === colons[1] + 1) {
                node.type = PromptNode.Weight
                node.invalid = !node.isNumeric
            } else if (index === colons[1] + 2) {
                node.type = PromptNode.Weight
                node.invalid = !node.isNumeric
            }
        }

        if (!colons[0]) {
            // only network type is allowed before first colon
            if (index === 1 && node.type !== PromptNode.NetworkType) {
                node.invalid = true
            }
            if (index > 1) {
                node.invalid = true
            }
        } else {
            if (!colons[1]) {
                if (index === colons[0] + 1 && node.type === PromptNode.Whitespace) {
                    node.invalid = true
                }
            } else {
                const before = children[colons[1] - 1]
                if (before.type === PromptNode.Whitespace) {
                    before.invalid = true
                }
            }
        }
    }
}

class PromptNode {
    static Whitespace = 'whitespace'
    static Keyword = 'keyword'
    static Delimiter = 'delimiter'
    static Linebreak = 'linebreak'
    static Prompt = 'prompt'
    static Block = 'block'
    static BlockStart = 'blockstart'
    static BlockEnd = 'blockend'
    static Block = 'block'
    static Weight = 'weight'
    static Network = 'network'
    static NetworkType = 'network-type'
    static Colon = 'colon'
    static Pipe = 'pipe'
    static Comment = 'comment'
    static Brackets = 'brackets'

    static blockPairs = {
        ')': '(',
        ']': '[',
        '>': '<'
    }

    static breaks = [
        'BREAK',
        'AND',
        'ADDCOL',
        'ADDROW',
        'ADDCOMM',
        'ADDBASE',
    ]

    inputText = ''
    content = ''
    type = PromptNode.Prompt
    delimiter = ','
    index = 0
    startIndex = 0
    children = []
    parent = null
    invalid = false
    blockType = PromptNode.Block

    get length() {
        if (this.children.length) {
            return this.children.reduce((sum, c) => sum + c.length, 0)
        }
        return this.content.length
    }

    get isNumeric() {
        return /^-?([0-9]*\.?[0-9]+)$/.test(this.content)
    }

    get nodeClass() {
        let value = `prompt-node prompt-node-${this.type}`
        switch (this.type) {
            case PromptNode.Keyword:
                if (PromptParser.increment) {
                    PromptParser.keyIndex++
                    PromptParser.increment = false
                }

                if (PromptNode.breaks.includes(this.content)) {
                    value = `${value} prompt-break`
                    break
                }

                const odd = PromptParser.keyIndex % 2 == 0
                value = `${value}${odd ? ' keyword-odd' : ''}`
                if (PromptNode.breaks.includes(this.content)) {
                    value = `${value} prompt-break`
                }
                break;

            case PromptNode.BlockStart:
            case PromptNode.BlockEnd:
                if (this.parent?.blockType === PromptNode.Network) {
                    value = `${value} network`
                }
                PromptParser.increment = true

                if (this.content === '(' || this.content === ')') {
                    value = `${value} block-parentheses`
                } else if (this.content === '[' || this.content === ']') {
                    value = `${value} block-brackets`
                } else if (this.content === '<' || this.content === '>') {
                    value = `${value} block-angle`
                }
                break;
            case PromptNode.Delimiter:
            case PromptNode.Pipe:
                PromptParser.increment = true
                break;
            case PromptNode.Weight:
                const val = parseFloat(this.content)
                if (val > 1) {
                    value = `${value} weight-up`
                } else if (val < 1) {
                    value = `${value} weight-down`
                }
                break;
            case PromptNode.Block:
                // value = `${value} type-${this.blockType}`

                const weight = this.children.find((o) => o.type === PromptNode.Weight)
                if (weight) {
                    const val = parseFloat(weight.content)

                    if (val > 1) {
                        value = `${value} weight-up`
                    } else if (val < 1) {
                        value = `${value} weight-down`
                    }
                }
                break
        }

        if (this.invalid) {
            value = `${value} invalid`
        }

        return value
    }

    get value() {
        return this.inputText[this.index]
    }

    getValue(index) {
        return this.inputText[index]
    }

    constructor(text, parent, type = PromptNode.Prompt) {
        this.inputText = text
        this.parent = parent
        this.type = type
    }

    append = (char) => {
        const val = char ?? this.value

        if (val !== undefined) {
            this.content = `${this.content}${val}`
        }
    }

    addNode(node) {
        this.children.push(node)
    }

    getChild = (index) => {
        return this.children.slice(index)[0]
    }

    isWhitespace = (char) => {
        return /^\s+$/.test(char) && char !== '\n'
    }

    predictType = (char) => {

        if (this.isWhitespace(char)) return PromptNode.Whitespace
        if (char === this.delimiter) return PromptNode.Delimiter
        if (Object.values(PromptNode.blockPairs).includes(char)) return PromptNode.BlockStart
        if (Object.keys(PromptNode.blockPairs).includes(char)) return PromptNode.BlockEnd
        if (char === ':') return PromptNode.Colon
        if (char === '\n') return PromptNode.Linebreak
        if (char === '|') return PromptNode.Pipe
        if (char === '#') return PromptNode.Comment

        return PromptNode.Keyword
    }

    next = () => {
        this.index++
        return this.inputText[this.index]
    }

    parse = (begin = 0) => {
        this.startIndex = begin
        this.index = begin

        this.type = this.predictType(this.value)
        this.append()

        switch (this.type) {
            case PromptNode.Whitespace:
                this.parseWhitespaces()
                break;

            case PromptNode.Delimiter:
            case PromptNode.BlockStart:
            case PromptNode.BlockEnd:
            case PromptNode.Colon:
            case PromptNode.Linebreak:
            case PromptNode.Pipe:
                this.next()
                break;

            case PromptNode.Comment:
                this.parseComment()
                break

            default:
                this.parseKeyword()
        }

        return this.index
    }

    parseWhitespaces = () => {
        while (this.index < this.inputText.length) {
            this.next()
            if (!this.isWhitespace(this.value)) {
                return;
            }
            this.append()
        }
    }

    parseComment = () => {
        while (this.index < this.inputText.length) {
            this.next()
            if (this.value === '\n') {
                return;
            }
            this.append()
        }
    }

    parseKeyword = () => {
        while (this.index < this.inputText.length) {

            this.next()

            if (this.isWhitespace(this.value)) return;

            // check for escaped chars
            if (Object.values(PromptNode.blockPairs).includes(this.value)) {
                if (this.getValue(this.index - 1) !== '\\') {
                    return
                }
            }

            if (Object.keys(PromptNode.blockPairs).includes(this.value)) {
                if (this.getValue(this.index - 1) !== '\\') {
                    return
                }
            }

            if ([':', '\n', '|', '#', this.delimiter].includes(this.value)) return

            this.append()
        }
    }

    toJson = () => {
        if (this.children.length) {
            return {
                [`<span style='color: red'>${this.startIndex}</span> (${this.length}) ${this.type}`]: `<span style='padding: 0 5px; border-radius: 5px; background-color: rgb(31, 41, 55)'>${this.children.map(o => `<span class='${o.nodeClass}'>${o.toString()}</span>`).join('')}</span>`,
                children: this.children.map(o => o.toJson())
            }
        } else {
            return `<span style='color: red'>${this.startIndex}</span> (${this.length}) ${this.type} -> <span class='${this.nodeClass}' style='padding: 0 5px; border-radius: 5px; background-color: rgb(31, 41, 55)'>${this.escape(this.content)}</span>`
        }
    }

    escape = (str) => {
        return str.replace('<', '&lt;').replace('>', '&gt;')
    }

    toString = () => {
        if (this.children.length) {
            return `<span class='${this.nodeClass}'>${this.children.map(o => o.toString()).join('')}</span>`
        }

        return `<span class='${this.nodeClass}'>${this.escape(this.content)}</span>`
    }
}