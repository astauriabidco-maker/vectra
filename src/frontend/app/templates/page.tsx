'use client'

import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/Layout/DashboardLayout'

// ============================================
// TYPES
// ============================================
interface Template {
    id: string
    name: string
    language: string
    meta_status: string
    body_text: string
    variables_count: number
    wa_template_id?: string
    category?: string
    rejection_reason?: string
    content?: any  // Raw template JSON for duplication
    usage_count?: number
    last_used_at?: string
}

type HeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'FLOW' | 'CATALOG'

interface TemplateHeader {
    type: HeaderType
    text?: string
    example_media_handle?: string
    mediaUrl?: string  // Local uploaded media URL
    mediaId?: string   // Media library ID
}

interface TemplateFooter {
    text: string
}

interface TemplateButton {
    type: ButtonType
    text: string
    url?: string
    phone_number?: string
    example_code?: string
    flow_id?: string
    flow_action?: string
    navigate_screen?: string
    thumbnail_product_retailer_id?: string
}

// ============================================
// API URL & CONFIG
// ============================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const LANGUAGES = [
    { code: 'fr', label: 'Français' },
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'pt_BR', label: 'Português (Brasil)' },
    { code: 'ar', label: 'العربية' },
]

const BUTTON_TYPES: { value: ButtonType; label: string; icon: string }[] = [
    { value: 'QUICK_REPLY', label: 'Réponse Rapide', icon: '💬' },
    { value: 'URL', label: 'Lien URL', icon: '🔗' },
    { value: 'PHONE_NUMBER', label: 'Numéro de Téléphone', icon: '📞' },
    { value: 'COPY_CODE', label: 'Copier Code Promo', icon: '🎟️' },
    { value: 'FLOW', label: 'WhatsApp Flow', icon: '🔄' },
    { value: 'CATALOG', label: 'Voir le Catalogue', icon: '🛒' },
]

// ============================================
// MAIN COMPONENT
// ============================================
export default function TemplatesPage() {
    const [templates, setTemplates] = useState<Template[]>([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [syncMessage, setSyncMessage] = useState<string | null>(null)

    // Modal state
    const [showModal, setShowModal] = useState(false)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState<string | null>(null)

    // Form state - Basic
    const [formName, setFormName] = useState('')
    const [formCategory, setFormCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING')
    const [formLanguage, setFormLanguage] = useState('fr')
    const [formBody, setFormBody] = useState('')

    // Form state - Advanced (V3.7)
    const [formHeader, setFormHeader] = useState<TemplateHeader>({ type: 'NONE' })
    const [formFooter, setFormFooter] = useState<TemplateFooter>({ text: '' })
    const [formButtons, setFormButtons] = useState<TemplateButton[]>([])

    // Media Library state (V3.10)
    const [showMediaLibrary, setShowMediaLibrary] = useState(false)
    const [mediaLibrary, setMediaLibrary] = useState<Array<{
        id: string
        filename: string
        original_name: string
        mime_type: string
        size_bytes: number
        url: string
        media_type: string
        created_at: string
    }>>([])
    const [uploadingMedia, setUploadingMedia] = useState(false)

    // Test Template Modal state
    const [showTestModal, setShowTestModal] = useState(false)
    const [testTemplate, setTestTemplate] = useState<Template | null>(null)
    const [testPhone, setTestPhone] = useState('')
    const [testVariables, setTestVariables] = useState<string[]>([])
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

    // Translation Modal state
    const [showTranslateModal, setShowTranslateModal] = useState(false)
    const [translateTemplate, setTranslateTemplate] = useState<Template | null>(null)
    const [selectedTranslateLanguage, setSelectedTranslateLanguage] = useState('')
    const [translating, setTranslating] = useState(false)

    // Version History Modal state
    interface TemplateVersion {
        id: number
        version_number: number
        name: string
        language: string
        category: string
        body_text: string
        meta_status: string
        change_type: string
        change_description: string
        changed_by: string
        created_at: string
    }
    const [showHistoryModal, setShowHistoryModal] = useState(false)
    const [historyTemplate, setHistoryTemplate] = useState<Template | null>(null)
    const [versions, setVersions] = useState<TemplateVersion[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [restoringVersion, setRestoringVersion] = useState<number | null>(null)

    const bodyRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Helper for authenticated requests
    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token')
        return fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
                'Authorization': `Bearer ${token}`,
            },
        })
    }

    // ============================================
    // FETCH TEMPLATES
    // ============================================
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const res = await authFetch(`${API_URL}/templates`)
                if (res.ok) {
                    const data = await res.json()
                    setTemplates(data)
                }
            } catch (err) {
                console.error('Failed to fetch templates:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchTemplates()
    }, [])

    // ============================================
    // SYNC TEMPLATES
    // ============================================
    const handleSync = async () => {
        setSyncing(true)
        setSyncMessage(null)
        try {
            const res = await authFetch(`${API_URL}/templates/sync`, {
                method: 'POST',
                body: JSON.stringify({})
            })
            if (res.ok) {
                const data = await res.json()
                setTemplates(data.templates)
                setSyncMessage(data.message)
            } else {
                const error = await res.json()
                setSyncMessage(`Erreur: ${error.error}`)
            }
        } catch (err) {
            console.error('Failed to sync templates:', err)
            setSyncMessage('Erreur de connexion')
        } finally {
            setSyncing(false)
        }
    }

    // ============================================
    // MEDIA LIBRARY FUNCTIONS (V3.10)
    // ============================================
    const fetchMediaLibrary = async (type?: string) => {
        try {
            const url = type ? `${API_URL}/library/media?type=${type}` : `${API_URL}/library/media`
            const res = await authFetch(url)
            if (res.ok) {
                const data = await res.json()
                setMediaLibrary(data.media || [])
            }
        } catch (err) {
            console.error('Failed to fetch media library:', err)
        }
    }

    const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploadingMedia(true)
        try {
            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch(`${API_URL}/media/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: formData
            })

            if (res.ok) {
                const data = await res.json()
                // Select the uploaded media immediately
                setFormHeader({
                    ...formHeader,
                    mediaUrl: data.media.url,
                    mediaId: data.media.id
                })
                // Refresh library
                fetchMediaLibrary(formHeader.type)
            } else {
                const error = await res.json()
                setCreateError(`Upload error: ${error.error}`)
            }
        } catch (err) {
            console.error('Upload failed:', err)
            setCreateError('Failed to upload media')
        } finally {
            setUploadingMedia(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    const handleMediaSelect = (media: typeof mediaLibrary[0]) => {
        setFormHeader({
            ...formHeader,
            mediaUrl: media.url,
            mediaId: media.id
        })
        setShowMediaLibrary(false)
    }

    const deleteMedia = async (mediaId: string) => {
        try {
            const res = await authFetch(`${API_URL}/library/media/${mediaId}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                fetchMediaLibrary(formHeader.type)
            }
        } catch (err) {
            console.error('Failed to delete media:', err)
        }
    }

    // ============================================
    // VALIDATE TEMPLATE (Meta Rules)
    // ============================================
    type ValidationResult = { type: 'error' | 'warning'; message: string }

    const validateTemplate = (): ValidationResult[] => {
        const issues: ValidationResult[] = []

        // === NAME VALIDATION ===
        if (!formName.trim()) {
            issues.push({ type: 'error', message: '❌ Le nom du template est requis' })
        } else {
            // Must be snake_case (lowercase, underscores, no spaces)
            if (!/^[a-z][a-z0-9_]*$/.test(formName)) {
                issues.push({ type: 'error', message: '❌ Le nom doit être en snake_case (ex: mon_template_promo)' })
            }
            if (formName.length > 64) {
                issues.push({ type: 'error', message: `❌ Le nom dépasse 64 caractères (${formName.length}/64)` })
            }
            if (formName.length < 3) {
                issues.push({ type: 'error', message: '❌ Le nom doit faire au moins 3 caractères' })
            }
        }

        // === BODY VALIDATION ===
        if (!formBody.trim()) {
            issues.push({ type: 'error', message: '❌ Le corps du message est requis' })
        } else {
            if (formBody.length > 1024) {
                issues.push({ type: 'error', message: `❌ Le corps dépasse 1024 caractères (${formBody.length}/1024)` })
            }
            if (formBody.length < 10) {
                issues.push({ type: 'warning', message: '⚠️ Le corps est très court, Meta pourrait rejeter' })
            }

            // Check variable format and sequence
            const varMatches = formBody.match(/\{\{(\d+)\}\}/g)
            if (varMatches) {
                const varNumbers = varMatches.map(v => parseInt(v.replace(/[{}]/g, '')))
                const sorted = [...varNumbers].sort((a, b) => a - b)
                const expected = sorted.map((_, i) => i + 1)

                if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
                    issues.push({ type: 'error', message: '❌ Les variables doivent être séquentielles ({{1}}, {{2}}, {{3}}...)' })
                }

                if (varNumbers.length > 10) {
                    issues.push({ type: 'warning', message: '⚠️ Plus de 10 variables peut rendre le template complexe' })
                }
            }

            // Check for invalid variable format
            if (/\{\{[^}]*[^0-9}][^}]*\}\}/.test(formBody)) {
                issues.push({ type: 'error', message: '❌ Format de variable invalide. Utilisez {{1}}, {{2}}, etc.' })
            }

            // Prohibited keywords
            const prohibited = ['viagra', 'casino', 'lottery', 'crypto', 'bitcoin', 'forex', 'investment opportunity']
            const lowerBody = formBody.toLowerCase()
            for (const word of prohibited) {
                if (lowerBody.includes(word)) {
                    issues.push({ type: 'error', message: `❌ Mot interdit détecté: "${word}"` })
                }
            }

            // Special characters that might cause issues
            if (/[<>]/.test(formBody)) {
                issues.push({ type: 'warning', message: '⚠️ Les caractères < et > peuvent poser problème' })
            }
        }

        // === HEADER VALIDATION ===
        if (formHeader.type === 'TEXT' && formHeader.text) {
            if (formHeader.text.length > 60) {
                issues.push({ type: 'error', message: `❌ L'en-tête texte dépasse 60 caractères (${formHeader.text.length}/60)` })
            }
        }
        if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(formHeader.type) && !formHeader.mediaUrl) {
            issues.push({ type: 'warning', message: '⚠️ Aucun média sélectionné pour l\'en-tête' })
        }

        // === FOOTER VALIDATION ===
        if (formFooter.text && formFooter.text.length > 60) {
            issues.push({ type: 'error', message: `❌ Le pied de page dépasse 60 caractères (${formFooter.text.length}/60)` })
        }

        // === BUTTON VALIDATION ===
        if (formButtons.length > 0) {
            formButtons.forEach((btn, idx) => {
                if (!btn.text.trim()) {
                    issues.push({ type: 'error', message: `❌ Le bouton ${idx + 1} n'a pas de texte` })
                } else if (btn.text.length > 25) {
                    issues.push({ type: 'error', message: `❌ Le texte du bouton ${idx + 1} dépasse 25 caractères` })
                }

                if (btn.type === 'URL' && !btn.url) {
                    issues.push({ type: 'error', message: `❌ Le bouton URL ${idx + 1} n'a pas d'URL` })
                }
                if (btn.type === 'PHONE_NUMBER' && !btn.phone_number) {
                    issues.push({ type: 'error', message: `❌ Le bouton Téléphone ${idx + 1} n'a pas de numéro` })
                }
                if (btn.type === 'FLOW' && !btn.flow_id) {
                    issues.push({ type: 'error', message: `❌ Le bouton Flow ${idx + 1} n'a pas de Flow ID` })
                }
            })
        }

        return issues
    }

    // Get real-time validation issues
    const validationIssues = validateTemplate()
    const hasErrors = validationIssues.some(i => i.type === 'error')

    // ============================================
    // CREATE TEMPLATE
    // ============================================
    const handleCreate = async () => {
        // Check validation errors first
        if (hasErrors) {
            const errorMessages = validationIssues
                .filter(i => i.type === 'error')
                .map(i => i.message.replace(/^❌ /, ''))
                .join('\n• ')
            setCreateError(`Validation échouée:\n• ${errorMessages}`)
            return
        }

        setCreating(true)
        setCreateError(null)

        // Build request payload
        const payload: Record<string, unknown> = {
            name: formName,
            category: formCategory,
            language: formLanguage,
            bodyText: formBody,
        }

        // Add header if not NONE
        if (formHeader.type !== 'NONE') {
            payload.header = formHeader
        }

        // Add footer if has text
        if (formFooter.text.trim()) {
            payload.footer = formFooter
        }

        // Add buttons if any
        if (formButtons.length > 0) {
            payload.buttons = formButtons
        }

        try {
            const res = await authFetch(`${API_URL}/templates/create`, {
                method: 'POST',
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                const data = await res.json()
                setTemplates([data.template, ...templates])
                resetForm()
                setShowModal(false)
            } else {
                const error = await res.json()
                setCreateError(error.error || 'Erreur lors de la création')
            }
        } catch (err) {
            console.error('Failed to create template:', err)
            setCreateError('Erreur de connexion')
        } finally {
            setCreating(false)
        }
    }

    // ============================================
    // RESET FORM
    // ============================================
    const resetForm = () => {
        setFormName('')
        setFormCategory('MARKETING')
        setFormLanguage('fr')
        setFormBody('')
        setFormHeader({ type: 'NONE' })
        setFormFooter({ text: '' })
        setFormButtons([])
        setCreateError(null)
    }

    // ============================================
    // DUPLICATE TEMPLATE
    // ============================================
    const handleDuplicate = (template: Template) => {
        // Reset first
        resetForm()

        // Set name with suffix
        setFormName(`${template.name}_copie`)
        setFormLanguage(template.language || 'fr')
        setFormBody(template.body_text || '')

        // Try to restore full content from stored JSON if available
        if (template.content) {
            try {
                const content = typeof template.content === 'string'
                    ? JSON.parse(template.content)
                    : template.content

                // Restore category
                if (content.category) {
                    setFormCategory(content.category)
                }

                // Restore header
                const headerComp = content.components?.find((c: any) => c.type === 'HEADER')
                if (headerComp) {
                    setFormHeader({
                        type: headerComp.format || 'TEXT',
                        text: headerComp.text || ''
                    })
                }

                // Restore footer
                const footerComp = content.components?.find((c: any) => c.type === 'FOOTER')
                if (footerComp) {
                    setFormFooter({ text: footerComp.text || '' })
                }

                // Restore buttons
                const buttonsComp = content.components?.find((c: any) => c.type === 'BUTTONS')
                if (buttonsComp?.buttons) {
                    const buttons: TemplateButton[] = buttonsComp.buttons.map((btn: any) => ({
                        type: btn.type,
                        text: btn.text || '',
                        url: btn.url,
                        phone_number: btn.phone_number,
                        flow_id: btn.flow_id
                    }))
                    setFormButtons(buttons)
                }
            } catch (e) {
                console.warn('Could not parse template content for duplication:', e)
            }
        }

        // Open modal
        setShowModal(true)
    }

    // ============================================
    // TEST TEMPLATE
    // ============================================
    const handleOpenTest = (template: Template) => {
        setTestTemplate(template)
        setTestPhone('')
        setTestResult(null)

        // Initialize variables array based on variables_count
        if (template.variables_count > 0) {
            setTestVariables(Array(template.variables_count).fill(''))
        } else {
            setTestVariables([])
        }

        setShowTestModal(true)
    }

    const sendTestTemplate = async () => {
        if (!testTemplate || !testPhone.trim()) return

        setTesting(true)
        setTestResult(null)

        try {
            const res = await authFetch(`${API_URL}/templates/test`, {
                method: 'POST',
                body: JSON.stringify({
                    template_name: testTemplate.name,
                    template_language: testTemplate.language,
                    phone_number: testPhone.trim(),
                    variables: testVariables.filter(v => v.trim() !== '')
                })
            })

            const data = await res.json()

            if (res.ok) {
                setTestResult({ success: true, message: data.message || 'Template envoyé !' })
            } else {
                setTestResult({ success: false, message: data.error || 'Erreur lors de l\'envoi' })
            }
        } catch (err) {
            setTestResult({ success: false, message: 'Erreur de connexion au serveur' })
        } finally {
            setTesting(false)
        }
    }

    // ============================================
    // TRANSLATION - Create Multilingual Version
    // ============================================
    const SUPPORTED_LANGUAGES = [
        { code: 'fr', name: 'Français', flag: '🇫🇷' },
        { code: 'en', name: 'English', flag: '🇬🇧' },
        { code: 'en_US', name: 'English (US)', flag: '🇺🇸' },
        { code: 'es', name: 'Español', flag: '🇪🇸' },
        { code: 'pt_BR', name: 'Português (BR)', flag: '🇧🇷' },
        { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
        { code: 'it', name: 'Italiano', flag: '🇮🇹' },
        { code: 'ar', name: 'العربية', flag: '🇸🇦' },
        { code: 'zh_CN', name: '中文 (简体)', flag: '🇨🇳' },
        { code: 'ja', name: '日本語', flag: '🇯🇵' },
        { code: 'ko', name: '한국어', flag: '🇰🇷' },
        { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
        { code: 'pl', name: 'Polski', flag: '🇵🇱' },
        { code: 'ru', name: 'Русский', flag: '🇷🇺' },
        { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
    ]

    const handleOpenTranslate = (template: Template) => {
        setTranslateTemplate(template)
        setSelectedTranslateLanguage('')
        setShowTranslateModal(true)
    }

    // Version History functions
    const handleOpenHistory = async (template: Template) => {
        setHistoryTemplate(template)
        setShowHistoryModal(true)
        setLoadingHistory(true)
        setVersions([])

        try {
            const res = await authFetch(`${API_URL}/templates/${template.id}/history`)
            const data = await res.json()
            if (res.ok && data.versions) {
                setVersions(data.versions)
            }
        } catch (err) {
            console.error('Error fetching history:', err)
        } finally {
            setLoadingHistory(false)
        }
    }

    const handleRestoreVersion = async (versionId: number, versionNumber: number) => {
        if (!historyTemplate) return
        if (!confirm(`Restaurer la version ${versionNumber} ? Le contenu actuel sera remplacé.`)) return

        setRestoringVersion(versionId)

        try {
            const res = await authFetch(`${API_URL}/templates/${historyTemplate.id}/versions/${versionId}/restore`, {
                method: 'POST'
            })
            const data = await res.json()

            if (res.ok) {
                alert(`✅ Version ${versionNumber} restaurée avec succès !`)
                setShowHistoryModal(false)
                window.location.reload() // Refresh the page to see restored content
            } else {
                alert(`❌ Erreur: ${data.error}`)
            }
        } catch (err) {
            console.error('Error restoring version:', err)
            alert('❌ Erreur lors de la restauration')
        } finally {
            setRestoringVersion(null)
        }
    }

    const getChangeTypeLabel = (type: string) => {
        switch (type) {
            case 'created': return { icon: '🆕', label: 'Création' }
            case 'updated': return { icon: '✏️', label: 'Modification' }
            case 'status_changed': return { icon: '🔄', label: 'Statut modifié' }
            case 'restored': return { icon: '⏪', label: 'Restauration' }
            case 'pre_restore': return { icon: '📸', label: 'Snapshot' }
            case 'manual_snapshot': return { icon: '💾', label: 'Sauvegarde manuelle' }
            default: return { icon: '📝', label: type }
        }
    }

    const handleTranslate = async () => {
        if (!translateTemplate || !selectedTranslateLanguage) return

        setTranslating(true)

        // Pre-fill form with template data but different language
        resetForm()

        // Generate new name with language suffix
        const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === selectedTranslateLanguage)
        const baseName = translateTemplate.name.replace(/_[a-z]{2}(_[A-Z]{2})?$/, '') // Remove existing lang suffix
        const newName = `${baseName}_${selectedTranslateLanguage.toLowerCase().replace('_', '')}`

        setFormName(newName)
        setFormLanguage(selectedTranslateLanguage)
        setFormBody(translateTemplate.body_text || '')

        // Restore from content JSON if available
        if (translateTemplate.content) {
            try {
                const content = typeof translateTemplate.content === 'string'
                    ? JSON.parse(translateTemplate.content)
                    : translateTemplate.content

                if (content.category) setFormCategory(content.category)

                const headerComp = content.components?.find((c: any) => c.type === 'HEADER')
                if (headerComp) {
                    setFormHeader({
                        type: headerComp.format || 'TEXT',
                        text: headerComp.text || ''
                    })
                }

                const footerComp = content.components?.find((c: any) => c.type === 'FOOTER')
                if (footerComp) setFormFooter({ text: footerComp.text || '' })

                const buttonsComp = content.components?.find((c: any) => c.type === 'BUTTONS')
                if (buttonsComp?.buttons) {
                    const buttons: TemplateButton[] = buttonsComp.buttons.map((btn: any) => ({
                        type: btn.type,
                        text: btn.text || '',
                        url: btn.url,
                        phone_number: btn.phone_number,
                        flow_id: btn.flow_id
                    }))
                    setFormButtons(buttons)
                }
            } catch (e) {
                console.warn('Could not parse template content for translation:', e)
            }
        }

        setTranslating(false)
        setShowTranslateModal(false)
        setShowModal(true) // Open creation modal with pre-filled data
    }

    // INSERT VARIABLE
    // ============================================

    // Variable types with formatting hints
    const VARIABLE_TYPES = [
        {
            type: 'text',
            label: 'Texte',
            icon: '📝',
            placeholder: 'Nom, Prénom...',
            example: 'Jean Dupont',
            format: (v: string) => v
        },
        {
            type: 'date',
            label: 'Date',
            icon: '📅',
            placeholder: 'Date (JJ/MM/AAAA)',
            example: '31/01/2026',
            format: (v: string) => {
                try {
                    const d = new Date(v)
                    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                } catch { return v }
            }
        },
        {
            type: 'time',
            label: 'Heure',
            icon: '🕐',
            placeholder: 'Heure (HH:MM)',
            example: '14:30',
            format: (v: string) => {
                try {
                    const [h, m] = v.split(':')
                    return `${h.padStart(2, '0')}h${m.padStart(2, '0')}`
                } catch { return v }
            }
        },
        {
            type: 'datetime',
            label: 'Date & Heure',
            icon: '📆',
            placeholder: 'Date et heure',
            example: '31/01/2026 à 14:30',
            format: (v: string) => {
                try {
                    const d = new Date(v)
                    return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                } catch { return v }
            }
        },
        {
            type: 'currency',
            label: 'Montant',
            icon: '💰',
            placeholder: 'Montant (€)',
            example: '1 250,00 €',
            format: (v: string) => {
                try {
                    const num = parseFloat(v.replace(/[^0-9.,]/g, '').replace(',', '.'))
                    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(num)
                } catch { return v }
            }
        },
        {
            type: 'phone',
            label: 'Téléphone',
            icon: '📱',
            placeholder: 'Numéro de téléphone',
            example: '+33 6 12 34 56 78',
            format: (v: string) => {
                const digits = v.replace(/\D/g, '')
                if (digits.length === 10) {
                    return digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
                }
                return v
            }
        },
        {
            type: 'location',
            label: 'Lieu',
            icon: '📍',
            placeholder: 'Adresse, Ville...',
            example: '15 rue de Paris, 75001 Paris',
            format: (v: string) => v
        },
        {
            type: 'name',
            label: 'Nom complet',
            icon: '👤',
            placeholder: 'Prénom Nom',
            example: 'Marie Martin',
            format: (v: string) => v.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        },
    ]

    const [showVariableMenu, setShowVariableMenu] = useState(false)
    const [variableTypes, setVariableTypes] = useState<{ [key: number]: string }>({})

    const insertVariable = (type: string = 'text') => {
        if (!bodyRef.current) return
        const matches = formBody.match(/\{\{\d+\}\}/g)
        const nextVar = matches ? matches.length + 1 : 1
        const start = bodyRef.current.selectionStart
        const end = bodyRef.current.selectionEnd

        // Store variable type for later use
        setVariableTypes(prev => ({ ...prev, [nextVar]: type }))

        const varType = VARIABLE_TYPES.find(v => v.type === type)
        const newText = formBody.substring(0, start) + `{{${nextVar}}}` + formBody.substring(end)
        setFormBody(newText)
        setShowVariableMenu(false)

        setTimeout(() => {
            if (bodyRef.current) {
                bodyRef.current.focus()
                bodyRef.current.selectionStart = bodyRef.current.selectionEnd = start + `{{${nextVar}}}`.length
            }
        }, 0)
    }

    // Get variable info by number
    const getVariableInfo = (varNum: number) => {
        const type = variableTypes[varNum] || 'text'
        return VARIABLE_TYPES.find(v => v.type === type) || VARIABLE_TYPES[0]
    }

    // ============================================
    // BUTTON MANAGEMENT
    // ============================================
    const addButton = (type: ButtonType) => {
        if (formButtons.length >= 3) return
        const newButton: TemplateButton = { type, text: '' }
        if (type === 'FLOW') {
            newButton.flow_id = ''
            newButton.flow_action = 'navigate'
            newButton.navigate_screen = 'screen_1'
        }
        setFormButtons([...formButtons, newButton])
    }

    const updateButton = (index: number, updates: Partial<TemplateButton>) => {
        const updated = [...formButtons]
        updated[index] = { ...updated[index], ...updates }
        setFormButtons(updated)
    }

    const removeButton = (index: number) => {
        setFormButtons(formButtons.filter((_, i) => i !== index))
    }

    // ============================================
    // GET STATUS BADGE
    // ============================================
    const getStatusBadge = (template: Template) => {
        const status = template.meta_status
        const reason = template.rejection_reason

        switch (status) {
            case 'APPROVED':
                return (
                    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                        🟢 Prêt à l'envoi
                    </span>
                )
            case 'REJECTED':
                return (
                    <div className="group relative">
                        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full flex items-center gap-1 cursor-help border border-red-200">
                            🔴 Rejeté
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </span>
                        {/* Tooltip with rejection reason */}
                        <div className="invisible group-hover:visible absolute right-0 top-full mt-2 z-50 w-64 p-3 bg-red-50 border border-red-200 rounded-lg shadow-lg">
                            <p className="text-xs font-semibold text-red-800 mb-1">⚠️ Raison du rejet :</p>
                            <p className="text-xs text-red-700">
                                {reason || 'Non spécifiée par Meta. Vérifiez le contenu du template pour conformité aux règles WhatsApp.'}
                            </p>
                        </div>
                    </div>
                )
            case 'PENDING':
                return (
                    <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1 animate-pulse">
                        🟡 En validation
                    </span>
                )
            case 'PAUSED':
                return (
                    <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded-full flex items-center gap-1">
                        ⏸️ Suspendu
                    </span>
                )
            default:
                return (
                    <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                        {status}
                    </span>
                )
        }
    }

    // ============================================
    // RENDER BUTTON FIELDS
    // ============================================
    const renderButtonFields = (btn: TemplateButton, idx: number) => {
        const buttonType = BUTTON_TYPES.find(t => t.value === btn.type)

        return (
            <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                {/* Button Header */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">{buttonType?.icon}</span>
                        <span className="text-sm font-medium text-gray-700">{buttonType?.label}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => removeButton(idx)}
                        className="p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Common: Button Text */}
                {btn.type !== 'COPY_CODE' && (
                    <input
                        type="text"
                        value={btn.text}
                        onChange={(e) => updateButton(idx, { text: e.target.value })}
                        placeholder="Texte du bouton (max 25 car.)"
                        maxLength={25}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                    />
                )}

                {/* Type-specific fields */}
                {btn.type === 'URL' && (
                    <input
                        type="url"
                        value={btn.url || ''}
                        onChange={(e) => updateButton(idx, { url: e.target.value })}
                        placeholder="https://example.com ou https://site.com/{{1}}"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                    />
                )}

                {btn.type === 'PHONE_NUMBER' && (
                    <input
                        type="tel"
                        value={btn.phone_number || ''}
                        onChange={(e) => updateButton(idx, { phone_number: e.target.value })}
                        placeholder="+33612345678"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                    />
                )}

                {btn.type === 'COPY_CODE' && (
                    <input
                        type="text"
                        value={btn.example_code || ''}
                        onChange={(e) => updateButton(idx, { example_code: e.target.value })}
                        placeholder="Code promo: PROMO2026"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                    />
                )}

                {btn.type === 'FLOW' && (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={btn.flow_id || ''}
                            onChange={(e) => updateButton(idx, { flow_id: e.target.value })}
                            placeholder="Flow ID (ex: 123456789012345)"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                        />
                        <input
                            type="text"
                            value={btn.navigate_screen || 'screen_1'}
                            onChange={(e) => updateButton(idx, { navigate_screen: e.target.value })}
                            placeholder="Premier écran (défaut: screen_1)"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                        />
                        <p className="text-xs text-gray-400">
                            📌 Obtenez l'ID du Flow dans le WhatsApp Business Manager
                        </p>
                    </div>
                )}

                {btn.type === 'CATALOG' && (
                    <div className="space-y-2">
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                            🛒 <strong>Voir le Catalogue :</strong> Ce bouton ouvrira le catalogue produit de votre compte Meta Business.
                        </div>
                        <p className="text-xs text-gray-400">
                            📌 L'ID du produit sera demandé lors de l'envoi du message pour afficher la bonne vignette.
                        </p>
                    </div>
                )}
            </div>
        )
    }

    // ============================================
    // WHATSAPP PREVIEW COMPONENT
    // ============================================
    const WhatsAppPreview = () => {
        // Replace variables with typed example values for preview
        const previewBody = formBody.replace(/\{\{(\d+)\}\}/g, (_, num) => {
            const varInfo = getVariableInfo(parseInt(num))
            return `${varInfo.icon} ${varInfo.example}`
        })
        const previewHeaderText = formHeader.text?.replace(/\{\{(\d+)\}\}/g, (_, num) => {
            const varInfo = getVariableInfo(parseInt(num))
            return `${varInfo.icon} ${varInfo.example}`
        }) || ''

        return (
            <div className="flex flex-col items-center">
                <p className="text-xs font-medium text-gray-500 mb-3">📱 Aperçu en temps réel</p>

                {/* iPhone Frame */}
                <div className="relative w-[280px] h-[520px] bg-gray-900 rounded-[40px] p-2 shadow-xl">
                    {/* Screen */}
                    <div className="w-full h-full bg-[#e5ddd5] rounded-[32px] overflow-hidden flex flex-col">
                        {/* WhatsApp Header */}
                        <div className="bg-[#075E54] px-4 py-3 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-white">
                                WA
                            </div>
                            <div className="flex-1">
                                <p className="text-white font-medium text-sm">WhatsApp Business</p>
                                <p className="text-green-200 text-[10px]">en ligne</p>
                            </div>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 p-3 overflow-y-auto" style={{
                            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
                        }}>
                            {/* Message Bubble */}
                            <div className="bg-white rounded-lg rounded-tl-none shadow-sm max-w-[95%] overflow-hidden">
                                {/* Header Preview */}
                                {formHeader.type !== 'NONE' && (
                                    <div className="border-b border-gray-100">
                                        {formHeader.type === 'TEXT' && previewHeaderText && (
                                            <div className="px-3 py-2 bg-gray-50">
                                                <p className="font-semibold text-gray-800 text-sm">{previewHeaderText}</p>
                                            </div>
                                        )}
                                        {formHeader.type === 'IMAGE' && (
                                            formHeader.mediaUrl ? (
                                                <img
                                                    src={`${API_URL}${formHeader.mediaUrl}`}
                                                    alt="Header"
                                                    className="w-full h-32 object-cover"
                                                />
                                            ) : (
                                                <div className="h-32 bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                                                    <span className="text-4xl">🖼️</span>
                                                </div>
                                            )
                                        )}
                                        {formHeader.type === 'VIDEO' && (
                                            <div className="h-32 bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
                                                <span className="text-4xl">🎬</span>
                                            </div>
                                        )}
                                        {formHeader.type === 'DOCUMENT' && (
                                            <div className="h-16 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center gap-2">
                                                <span className="text-2xl">📄</span>
                                                <span className="text-xs text-gray-600">Document</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Body */}
                                <div className="px-3 py-2">
                                    <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                                        {previewBody || <span className="text-gray-400 italic">Votre message ici...</span>}
                                    </p>
                                </div>

                                {/* Footer */}
                                {formFooter.text && (
                                    <div className="px-3 pb-2">
                                        <p className="text-[11px] text-gray-500">{formFooter.text}</p>
                                    </div>
                                )}

                                {/* Timestamp */}
                                <div className="px-3 pb-2 flex justify-end">
                                    <span className="text-[10px] text-gray-400">
                                        {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>

                                {/* Buttons */}
                                {formButtons.length > 0 && (
                                    <div className="border-t border-gray-100">
                                        {formButtons.map((btn, idx) => (
                                            <div key={idx} className="border-b border-gray-100 last:border-b-0">
                                                <button className="w-full px-3 py-2.5 text-[#128C7E] text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                                                    {btn.type === 'URL' && '🔗'}
                                                    {btn.type === 'PHONE_NUMBER' && '📞'}
                                                    {btn.type === 'COPY_CODE' && '📋'}
                                                    {btn.type === 'FLOW' && '🔄'}
                                                    {btn.type === 'CATALOG' && '🛒'}
                                                    {btn.type === 'QUICK_REPLY' && '💬'}
                                                    {btn.text || `Bouton ${idx + 1}`}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Input Bar */}
                        <div className="bg-[#f0f0f0] px-3 py-2 flex items-center gap-2">
                            <div className="flex-1 bg-white rounded-full px-4 py-2 text-xs text-gray-400">
                                Écrire un message...
                            </div>
                            <div className="w-8 h-8 rounded-full bg-[#128C7E] flex items-center justify-center">
                                <span className="text-white text-sm">🎤</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Preview Stats */}
                <div className="mt-4 text-center space-y-1">
                    <p className="text-xs text-gray-500">
                        📝 {formBody.length}/1024 caractères
                    </p>
                    {formButtons.length > 0 && (
                        <p className="text-xs text-gray-500">
                            🔘 {formButtons.length}/3 boutons
                        </p>
                    )}
                </div>
            </div>
        )
    }

    // ============================================
    // RENDER
    // ============================================
    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Page Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">📋 Templates WhatsApp</h1>
                        <p className="text-gray-500 mt-1">Créez des templates avancés avec Header, Footer et Flows</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => { resetForm(); setShowModal(true) }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm bg-green-600 text-white hover:bg-green-700 transition-all"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Créer un Template
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${syncing
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-[#0668E1] to-[#1877F2] text-white hover:from-[#0559c4] hover:to-[#1469d8] shadow-md hover:shadow-lg'
                                }`}
                        >
                            {syncing ? (
                                <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" />
                                </svg>
                            )}
                            {syncing ? 'Importation...' : 'Importer depuis Meta'}
                        </button>
                    </div>
                </div>

                {/* Sync Message */}
                {syncMessage && (
                    <div className={`p-4 rounded-lg text-sm ${syncMessage.startsWith('Erreur')
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-green-50 text-green-700 border border-green-200'
                        }`}>
                        {syncMessage}
                    </div>
                )}

                {/* Loading State */}
                {loading ? (
                    <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#128C7E]"></div>
                        <p className="mt-2 text-gray-500">Chargement des templates...</p>
                    </div>
                ) : templates.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 className="text-lg font-medium text-gray-700">Aucun template</h3>
                        <p className="text-gray-500 mt-1">Créez un template ou synchronisez depuis Meta.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {templates.map(tpl => (
                            <div key={tpl.id} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 hover:shadow-md transition-shadow">
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-800">{tpl.name}</h3>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {tpl.language} {tpl.category && `• ${tpl.category}`}
                                        </p>
                                    </div>
                                    {getStatusBadge(tpl)}
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 mb-3 min-h-[80px]">
                                    <p className="text-sm text-gray-600 leading-relaxed">
                                        {tpl.body_text || <span className="italic text-gray-400">Pas de contenu</span>}
                                    </p>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                    <div className="flex items-center gap-2">
                                        {tpl.variables_count > 0 && (
                                            <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                                                {tpl.variables_count} var
                                            </span>
                                        )}
                                        {/* Usage Count Badge */}
                                        <span
                                            className="bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full flex items-center gap-1"
                                            title={tpl.last_used_at ? `Dernier envoi: ${new Date(tpl.last_used_at).toLocaleDateString('fr-FR')}` : 'Jamais utilisé'}
                                        >
                                            📊 {tpl.usage_count || 0} envois
                                        </span>
                                        {/* Duplicate Button */}
                                        <button
                                            onClick={() => handleDuplicate(tpl)}
                                            className="flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-purple-100 text-gray-600 hover:text-purple-700 rounded-md transition-colors"
                                            title="Dupliquer ce template"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                            Dupliquer
                                        </button>
                                        {/* Test Button - Only for APPROVED templates */}
                                        {tpl.meta_status === 'APPROVED' && (
                                            <button
                                                onClick={() => handleOpenTest(tpl)}
                                                className="flex items-center gap-1 px-2 py-1 bg-green-50 hover:bg-green-100 text-green-600 hover:text-green-700 rounded-md transition-colors"
                                                title="Envoyer un test à votre numéro"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                                </svg>
                                                Tester
                                            </button>
                                        )}
                                        {/* Translate Button - Create multilingual version */}
                                        <button
                                            onClick={() => handleOpenTranslate(tpl)}
                                            className="flex items-center gap-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700 rounded-md transition-colors"
                                            title="Créer une version dans une autre langue"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                                            </svg>
                                            Traduire
                                        </button>
                                        {/* History Button */}
                                        <button
                                            onClick={() => handleOpenHistory(tpl)}
                                            className="flex items-center gap-1 px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-700 rounded-md transition-colors"
                                            title="Voir l'historique des versions"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Historique
                                        </button>
                                    </div>
                                    {tpl.wa_template_id && (
                                        <span className="font-mono text-[10px] text-gray-400">
                                            ID: {tpl.wa_template_id.slice(0, 8)}...
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Stats Footer */}
                {!loading && templates.length > 0 && (
                    <div className="flex items-center justify-center gap-6 text-sm text-gray-500 bg-white rounded-xl shadow-sm py-4">
                        <span>✅ {templates.filter(t => t.meta_status === 'APPROVED').length} Approuvés</span>
                        <span>⏳ {templates.filter(t => t.meta_status === 'PENDING').length} En attente</span>
                        <span>❌ {templates.filter(t => t.meta_status === 'REJECTED').length} Rejetés</span>
                    </div>
                )}

                {/* Advanced Template Builder Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                            {/* Modal Header */}
                            <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white z-10">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">✨ Template Builder Avancé</h2>
                                    <p className="text-sm text-gray-500 mt-0.5">Header, Footer, Flows et plus</p>
                                </div>
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Modal Body - Two Column Layout */}
                            <div className="flex-1 overflow-hidden">
                                <div className="h-full flex">
                                    {/* Left Column - Form */}
                                    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                                        {/* Error Message */}
                                        {createError && (
                                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                                {createError}
                                            </div>
                                        )}

                                        {/* ===== SECTION: BASIC INFO ===== */}
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Informations de base</h3>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du template</label>
                                                <input
                                                    type="text"
                                                    value={formName}
                                                    onChange={(e) => setFormName(e.target.value)}
                                                    placeholder="Ex: Promo Été 2026"
                                                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                                                />
                                                <p className="text-xs text-gray-400 mt-1">💡 Converti en snake_case automatiquement</p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                                                    <select
                                                        value={formCategory}
                                                        onChange={(e) => setFormCategory(e.target.value as 'MARKETING' | 'UTILITY')}
                                                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent bg-white"
                                                    >
                                                        <option value="MARKETING">📢 Marketing</option>
                                                        <option value="UTILITY">🔧 Utilitaire</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Langue</label>
                                                    <select
                                                        value={formLanguage}
                                                        onChange={(e) => setFormLanguage(e.target.value)}
                                                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent bg-white"
                                                    >
                                                        {LANGUAGES.map(lang => (
                                                            <option key={lang.code} value={lang.code}>{lang.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>

                                        <hr className="border-gray-100" />

                                        {/* ===== SECTION: HEADER ===== */}
                                        <div className="space-y-3">
                                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">📎 Header (optionnel)</h3>

                                            <select
                                                value={formHeader.type}
                                                onChange={(e) => setFormHeader({ type: e.target.value as HeaderType })}
                                                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent bg-white"
                                            >
                                                <option value="NONE">Aucun header</option>
                                                <option value="TEXT">📝 Texte</option>
                                                <option value="IMAGE">🖼️ Image</option>
                                                <option value="VIDEO">🎥 Vidéo</option>
                                                <option value="DOCUMENT">📄 Document</option>
                                            </select>

                                            {formHeader.type === 'TEXT' && (
                                                <input
                                                    type="text"
                                                    value={formHeader.text || ''}
                                                    onChange={(e) => setFormHeader({ ...formHeader, text: e.target.value })}
                                                    placeholder="Texte du header (supporte {{1}} pour variable)"
                                                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                                                />
                                            )}

                                            {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(formHeader.type) && (
                                                <div className="space-y-3">
                                                    {/* Selected Media Preview */}
                                                    {formHeader.mediaUrl ? (
                                                        <div className="relative border-2 border-green-300 rounded-lg p-3 bg-green-50">
                                                            <div className="flex items-center gap-3">
                                                                {formHeader.type === 'IMAGE' && (
                                                                    <img
                                                                        src={`${API_URL}${formHeader.mediaUrl}`}
                                                                        alt="Header"
                                                                        className="w-20 h-20 object-cover rounded-lg"
                                                                    />
                                                                )}
                                                                {formHeader.type === 'VIDEO' && (
                                                                    <div className="w-20 h-20 bg-purple-100 rounded-lg flex items-center justify-center">
                                                                        <span className="text-3xl">🎬</span>
                                                                    </div>
                                                                )}
                                                                {formHeader.type === 'DOCUMENT' && (
                                                                    <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                                                                        <span className="text-3xl">📄</span>
                                                                    </div>
                                                                )}
                                                                <div className="flex-1">
                                                                    <p className="text-sm font-medium text-green-700">✓ Média sélectionné</p>
                                                                    <p className="text-xs text-green-600">{formHeader.mediaUrl.split('/').pop()}</p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setFormHeader({ ...formHeader, mediaUrl: undefined, mediaId: undefined })}
                                                                    className="text-red-500 hover:text-red-700 p-2"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#128C7E] transition-colors">
                                                            <input
                                                                type="file"
                                                                ref={fileInputRef}
                                                                onChange={handleMediaUpload}
                                                                accept={
                                                                    formHeader.type === 'IMAGE' ? 'image/jpeg,image/png,image/webp' :
                                                                        formHeader.type === 'VIDEO' ? 'video/mp4,video/3gpp' :
                                                                            '.pdf,.doc,.docx'
                                                                }
                                                                className="hidden"
                                                                id="header-media-upload"
                                                            />
                                                            <label
                                                                htmlFor="header-media-upload"
                                                                className="cursor-pointer flex flex-col items-center"
                                                            >
                                                                {uploadingMedia ? (
                                                                    <div className="text-center">
                                                                        <span className="text-3xl animate-pulse">⏳</span>
                                                                        <p className="text-sm text-gray-500 mt-2">Upload en cours...</p>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <span className="text-4xl mb-2">
                                                                            {formHeader.type === 'IMAGE' ? '🖼️' : formHeader.type === 'VIDEO' ? '🎬' : '📄'}
                                                                        </span>
                                                                        <p className="text-sm font-medium text-gray-700">
                                                                            Cliquez pour uploader un{formHeader.type === 'IMAGE' ? 'e image' : formHeader.type === 'VIDEO' ? 'e vidéo' : ' document'}
                                                                        </p>
                                                                        <p className="text-xs text-gray-400 mt-1">
                                                                            {formHeader.type === 'IMAGE' ? 'JPG, PNG, WebP (max 10MB)' :
                                                                                formHeader.type === 'VIDEO' ? 'MP4, 3GPP (max 10MB)' :
                                                                                    'PDF, DOC, DOCX (max 10MB)'}
                                                                        </p>
                                                                    </>
                                                                )}
                                                            </label>
                                                        </div>
                                                    )}

                                                    {/* Browse Library Button */}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            fetchMediaLibrary(formHeader.type)
                                                            setShowMediaLibrary(true)
                                                        }}
                                                        className="w-full py-2 px-4 text-sm text-[#128C7E] border border-[#128C7E] rounded-lg hover:bg-[#128C7E]/10 transition-colors"
                                                    >
                                                        📚 Choisir depuis la bibliothèque
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <hr className="border-gray-100" />

                                        {/* ===== SECTION: BODY ===== */}
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">📄 Corps du message</h3>
                                                <div className="flex items-center gap-2">
                                                    {/* Variable Type Menu */}
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowVariableMenu(!showVariableMenu)}
                                                            className="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-all flex items-center gap-1 shadow-sm"
                                                        >
                                                            <span>+</span>
                                                            <span>Variable</span>
                                                            <svg className={`w-3 h-3 transition-transform ${showVariableMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </button>

                                                        {/* Dropdown Menu */}
                                                        {showVariableMenu && (
                                                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
                                                                <div className="p-2 bg-gray-50 border-b">
                                                                    <p className="text-xs font-medium text-gray-600">Choisir le type de variable</p>
                                                                </div>
                                                                <div className="max-h-72 overflow-y-auto py-1">
                                                                    {VARIABLE_TYPES.map(varType => (
                                                                        <button
                                                                            key={varType.type}
                                                                            type="button"
                                                                            onClick={() => insertVariable(varType.type)}
                                                                            className="w-full px-3 py-2 text-left hover:bg-blue-50 flex items-center gap-3 transition-colors"
                                                                        >
                                                                            <span className="text-lg">{varType.icon}</span>
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="text-sm font-medium text-gray-700">{varType.label}</p>
                                                                                <p className="text-xs text-gray-400 truncate">{varType.example}</p>
                                                                            </div>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className={`text-xs ${formBody.length > 1024 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                                                        {formBody.length}/1024
                                                    </span>
                                                </div>
                                            </div>
                                            <textarea
                                                ref={bodyRef}
                                                value={formBody}
                                                onChange={(e) => setFormBody(e.target.value)}
                                                placeholder="Bonjour {{1}}, merci de votre inscription ! 🎉"
                                                rows={4}
                                                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent resize-none"
                                            />

                                            {/* Variable Legend */}
                                            {Object.keys(variableTypes).length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {Object.entries(variableTypes).map(([num, type]) => {
                                                        const varInfo = VARIABLE_TYPES.find(v => v.type === type) || VARIABLE_TYPES[0]
                                                        return (
                                                            <span
                                                                key={num}
                                                                className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-600"
                                                            >
                                                                <span className="text-sm">{varInfo.icon}</span>
                                                                <span className="font-mono">{`{{${num}}}`}</span>
                                                                <span className="text-gray-400">= {varInfo.label}</span>
                                                            </span>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        <hr className="border-gray-100" />

                                        {/* ===== SECTION: FOOTER ===== */}
                                        <div className="space-y-3">
                                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">📝 Footer (optionnel)</h3>
                                            <input
                                                type="text"
                                                value={formFooter.text}
                                                onChange={(e) => setFormFooter({ text: e.target.value })}
                                                placeholder="Texte court en gris (ex: Répondez STOP pour vous désabonner)"
                                                maxLength={60}
                                                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#128C7E] focus:border-transparent"
                                            />
                                            <p className="text-xs text-gray-400">{formFooter.text.length}/60 caractères</p>
                                        </div>

                                        <hr className="border-gray-100" />

                                        {/* ===== SECTION: BUTTONS ===== */}
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">🔘 Boutons (max 3)</h3>
                                                {formButtons.length < 3 && (
                                                    <div className="relative">
                                                        <select
                                                            onChange={(e) => {
                                                                if (e.target.value) {
                                                                    addButton(e.target.value as ButtonType)
                                                                    e.target.value = ''
                                                                }
                                                            }}
                                                            className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-700 cursor-pointer"
                                                            defaultValue=""
                                                        >
                                                            <option value="" disabled>+ Ajouter un bouton</option>
                                                            {BUTTON_TYPES.map(bt => (
                                                                <option key={bt.value} value={bt.value}>
                                                                    {bt.icon} {bt.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}
                                            </div>

                                            {formButtons.length === 0 ? (
                                                <p className="text-sm text-gray-400 italic">Aucun bouton ajouté</p>
                                            ) : (
                                                <div className="space-y-3">
                                                    {formButtons.map((btn, idx) => renderButtonFields(btn, idx))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right Column - Preview */}
                                    <div className="w-[340px] bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto hidden lg:block">
                                        <WhatsAppPreview />
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer with Validation Panel */}
                            <div className="border-t bg-gray-50 sticky bottom-0">
                                {/* Validation Issues Panel */}
                                {validationIssues.length > 0 && (
                                    <div className="px-6 py-3 border-b bg-white">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-sm font-medium text-gray-700">
                                                📋 Validation Meta
                                            </span>
                                            {hasErrors ? (
                                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                                                    {validationIssues.filter(i => i.type === 'error').length} erreur(s)
                                                </span>
                                            ) : (
                                                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                                                    ✓ Prêt
                                                </span>
                                            )}
                                        </div>
                                        <div className="space-y-1 max-h-24 overflow-y-auto">
                                            {validationIssues.map((issue, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`text-xs px-2 py-1 rounded ${issue.type === 'error'
                                                        ? 'bg-red-50 text-red-700'
                                                        : 'bg-yellow-50 text-yellow-700'
                                                        }`}
                                                >
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Buttons */}
                                <div className="flex items-center justify-end gap-3 p-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="px-4 py-2.5 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        onClick={handleCreate}
                                        disabled={creating || hasErrors}
                                        className={`px-6 py-2.5 font-medium rounded-lg transition-colors flex items-center gap-2 ${hasErrors
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                            : 'bg-[#128C7E] text-white hover:bg-[#075E54]'
                                            } disabled:opacity-70`}
                                    >
                                        {creating ? (
                                            <>
                                                <span className="animate-spin">⏳</span>
                                                Soumission...
                                            </>
                                        ) : hasErrors ? (
                                            <>
                                                🚫 Corriger les erreurs
                                            </>
                                        ) : (
                                            <>
                                                🚀 Soumettre à Meta
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Media Library Modal */}
                {showMediaLibrary && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">📚 Bibliothèque Média</h3>
                                    <p className="text-sm text-gray-500">
                                        {formHeader.type === 'IMAGE' ? 'Images' : formHeader.type === 'VIDEO' ? 'Vidéos' : 'Documents'} uploadés
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowMediaLibrary(false)}
                                    className="p-2 hover:bg-gray-100 rounded-lg"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Media Grid */}
                            <div className="flex-1 p-4 overflow-y-auto">
                                {mediaLibrary.length === 0 ? (
                                    <div className="text-center py-12">
                                        <span className="text-5xl mb-4 block">📭</span>
                                        <p className="text-gray-500">Aucun média uploadé</p>
                                        <p className="text-sm text-gray-400 mt-1">Uploadez un fichier via le dropzone</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-4">
                                        {mediaLibrary.map((media) => (
                                            <div
                                                key={media.id}
                                                onClick={() => handleMediaSelect(media)}
                                                className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all hover:border-[#128C7E] ${formHeader.mediaId === media.id ? 'border-[#128C7E] ring-2 ring-[#128C7E]/30' : 'border-gray-200'
                                                    }`}
                                            >
                                                {/* Thumbnail */}
                                                {media.media_type === 'IMAGE' ? (
                                                    <img
                                                        src={`${API_URL}${media.url}`}
                                                        alt={media.original_name}
                                                        className="w-full h-24 object-cover"
                                                    />
                                                ) : (
                                                    <div className={`w-full h-24 flex items-center justify-center ${media.media_type === 'VIDEO' ? 'bg-purple-100' : 'bg-gray-100'
                                                        }`}>
                                                        <span className="text-3xl">
                                                            {media.media_type === 'VIDEO' ? '🎬' : '📄'}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Info */}
                                                <div className="p-2 bg-white">
                                                    <p className="text-xs font-medium text-gray-700 truncate">
                                                        {media.original_name}
                                                    </p>
                                                    <p className="text-[10px] text-gray-400">
                                                        {(media.size_bytes / 1024).toFixed(1)} KB
                                                    </p>
                                                </div>

                                                {/* Delete Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        deleteMedia(media.id)
                                                    }}
                                                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 transition-colors"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t bg-gray-50">
                                <button
                                    onClick={() => setShowMediaLibrary(false)}
                                    className="w-full py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                                >
                                    Fermer
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Test Template Modal */}
                {showTestModal && testTemplate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                            {/* Header */}
                            <div className="p-5 border-b bg-gradient-to-r from-green-500 to-emerald-600">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-white text-lg">Tester le template</h3>
                                            <p className="text-white/80 text-sm">{testTemplate.name}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowTestModal(false)}
                                        className="text-white/80 hover:text-white"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-5 space-y-4">
                                {/* Phone Number */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                        📱 Numéro WhatsApp destinataire
                                    </label>
                                    <input
                                        type="tel"
                                        value={testPhone}
                                        onChange={(e) => setTestPhone(e.target.value)}
                                        placeholder="+33 6 12 34 56 78"
                                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Format international avec indicatif pays
                                    </p>
                                </div>

                                {/* Variables */}
                                {testTemplate.variables_count > 0 && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            📝 Valeurs des variables ({testTemplate.variables_count})
                                        </label>
                                        <div className="space-y-2">
                                            {testVariables.map((v, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <span className="text-sm font-mono bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                                        {`{{${idx + 1}}}`}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={v}
                                                        onChange={(e) => {
                                                            const newVars = [...testVariables]
                                                            newVars[idx] = e.target.value
                                                            setTestVariables(newVars)
                                                        }}
                                                        placeholder={`Valeur pour la variable ${idx + 1}`}
                                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Live Template Preview with Variables */}
                                <div className="bg-[#e5ddd5] rounded-xl p-3 shadow-inner">
                                    <p className="text-xs font-medium text-gray-600 mb-2 text-center">📱 Aperçu en direct</p>
                                    <div className="bg-white rounded-lg rounded-tl-none shadow-sm p-3 max-w-[95%]">
                                        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                                            {testTemplate.body_text.replace(/\{\{(\d+)\}\}/g, (match, num) => {
                                                const idx = parseInt(num) - 1
                                                const value = testVariables[idx]
                                                if (value && value.trim()) {
                                                    return value
                                                }
                                                return `[Variable ${num}]`
                                            })}
                                        </p>
                                        <div className="flex justify-end mt-1">
                                            <span className="text-[10px] text-gray-400">
                                                {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ✓✓
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Result */}
                                {testResult && (
                                    <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                        <div className="flex items-center gap-2">
                                            {testResult.success ? (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            ) : (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            )}
                                            <span className="text-sm font-medium">{testResult.message}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-5 border-t bg-gray-50 flex gap-3">
                                <button
                                    onClick={() => setShowTestModal(false)}
                                    className="flex-1 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={sendTestTemplate}
                                    disabled={testing || !testPhone.trim()}
                                    className={`flex-1 py-2.5 font-medium rounded-lg transition-all flex items-center justify-center gap-2
                                        ${testing || !testPhone.trim()
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                            : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                >
                                    {testing ? (
                                        <>
                                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Envoi...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                            </svg>
                                            Envoyer le test
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Translation Modal */}
                {showTranslateModal && translateTemplate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
                            {/* Header */}
                            <div className="p-5 border-b bg-gradient-to-r from-amber-500 to-orange-500">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                            🌍 Créer une version multilingue
                                        </h3>
                                        <p className="text-amber-100 text-sm mt-1">
                                            <span className="font-mono bg-amber-600/50 px-2 py-0.5 rounded">{translateTemplate.name}</span>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowTranslateModal(false)}
                                        className="text-white/80 hover:text-white"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-5">
                                <p className="text-sm text-gray-600 mb-4">
                                    Langue actuelle : <span className="font-semibold">{translateTemplate.language}</span>
                                    <br />
                                    Sélectionnez une nouvelle langue pour créer une copie traduite.
                                </p>

                                {/* Language Grid */}
                                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                                    {SUPPORTED_LANGUAGES
                                        .filter(lang => lang.code !== translateTemplate.language)
                                        .map(lang => (
                                            <button
                                                key={lang.code}
                                                onClick={() => setSelectedTranslateLanguage(lang.code)}
                                                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${selectedTranslateLanguage === lang.code
                                                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                                                    : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                                                    }`}
                                            >
                                                <span className="text-xl">{lang.flag}</span>
                                                <span className="text-sm font-medium truncate">{lang.name}</span>
                                            </button>
                                        ))}
                                </div>

                                {selectedTranslateLanguage && (
                                    <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                                        <p className="text-sm text-amber-800">
                                            📝 Le formulaire sera pré-rempli avec le contenu du template.
                                            <br />
                                            <span className="text-amber-600">Pensez à traduire le texte avant de soumettre !</span>
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-end gap-3 p-5 border-t bg-gray-50">
                                <button
                                    onClick={() => setShowTranslateModal(false)}
                                    className="px-4 py-2.5 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={handleTranslate}
                                    disabled={!selectedTranslateLanguage || translating}
                                    className="px-6 py-2.5 bg-amber-500 text-white font-medium rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {translating ? (
                                        <>
                                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Préparation...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                            </svg>
                                            Créer la version {SUPPORTED_LANGUAGES.find(l => l.code === selectedTranslateLanguage)?.flag || ''}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* History Modal */}
                {showHistoryModal && historyTemplate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                            {/* Header */}
                            <div className="p-5 border-b bg-gradient-to-r from-slate-600 to-slate-700 flex-shrink-0">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                            📜 Historique des versions
                                        </h3>
                                        <p className="text-slate-300 text-sm mt-1">
                                            <span className="font-mono bg-slate-500/50 px-2 py-0.5 rounded">{historyTemplate.name}</span>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowHistoryModal(false)}
                                        className="text-white/80 hover:text-white"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-5">
                                {loadingHistory ? (
                                    <div className="flex items-center justify-center py-12">
                                        <svg className="w-8 h-8 animate-spin text-slate-400" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    </div>
                                ) : versions.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <p className="font-medium">Aucun historique</p>
                                        <p className="text-sm">Ce template n'a pas encore de versions enregistrées.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {versions.map((version) => {
                                            const changeInfo = getChangeTypeLabel(version.change_type)
                                            return (
                                                <div
                                                    key={version.id}
                                                    className="border rounded-xl p-4 hover:border-slate-300 hover:bg-slate-50/50 transition-all group"
                                                >
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded">
                                                                    v{version.version_number}
                                                                </span>
                                                                <span className="text-sm">
                                                                    {changeInfo.icon} {changeInfo.label}
                                                                </span>
                                                                <span className="text-xs text-gray-400">
                                                                    {new Date(version.created_at).toLocaleString('fr-FR')}
                                                                </span>
                                                            </div>
                                                            {version.change_description && (
                                                                <p className="text-sm text-gray-600 mb-2">
                                                                    {version.change_description}
                                                                </p>
                                                            )}
                                                            {version.body_text && (
                                                                <p className="text-xs text-gray-400 truncate">
                                                                    📝 {version.body_text.slice(0, 100)}...
                                                                </p>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => handleRestoreVersion(version.id, version.version_number)}
                                                            disabled={restoringVersion === version.id}
                                                            className="flex-shrink-0 px-3 py-1.5 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                                                        >
                                                            {restoringVersion === version.id ? (
                                                                <span className="flex items-center gap-1">
                                                                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24">
                                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                                    </svg>
                                                                    ...
                                                                </span>
                                                            ) : (
                                                                '⏪ Restaurer'
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between p-5 border-t bg-gray-50 flex-shrink-0">
                                <p className="text-xs text-gray-500">
                                    {versions.length} version(s) enregistrée(s)
                                </p>
                                <button
                                    onClick={() => setShowHistoryModal(false)}
                                    className="px-4 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    Fermer
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    )
}
